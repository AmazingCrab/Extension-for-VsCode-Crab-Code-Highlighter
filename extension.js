/**
 * Code Highlighter Extension for VS Code
 * 
 * This extension allows users to highlight code sections with customizable colors
 * to identify architecture layers, modules, and organize code structure.
 * Highlights are persistent and saved in a highlights.json file.
 * 
 * @author AmazingCrab
 * @version 1.0.0
 */

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

// ============================================================================
// GLOBAL STATE
// ============================================================================

/**
 * Map storing all highlights by document URI
 * Structure: Map<uri: string, Map<color: string, Decoration[]>>
 */
let highlightDecorations = new Map();

/**
 * Map storing decoration types by color
 * Structure: Map<color: string, TextEditorDecorationType>
 */
let decorationTypes = new Map();

/**
 * Extension context for VS Code API
 */
let context;

/**
 * Toggle state for showing/hiding highlights
 */
let colorsEnabled = true;

/**
 * Status bar item showing current toggle state
 */
let statusBarItem;

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

/**
 * Default color palette for architecture layers
 * Each color includes name, description, and hex value with transparency
 */
const defaultColors = [
    { name: 'Model Layer', description: 'Data models, entities, DTOs', value: '#00FFAA50' }, // Verde fosforescente
    { name: 'View Layer', description: 'UI components, templates, views', value: '#FF00FF50' }, // Magenta neón
    { name: 'Controller Layer', description: 'Request handlers, routing controllers', value: '#00FFFF50' }, // Cian brillante
    { name: 'Service Layer', description: 'Business logic, service classes', value: '#FFFF0050' }, // Amarillo neón
    { name: 'Data Access', description: 'Database queries, repositories, ORM', value: '#FF00AA50' }, // Rosa fluorescente
    { name: 'API Routes', description: 'API endpoints, route definitions', value: '#00FF0050' }, // Verde lima
    { name: 'Utilities', description: 'Helper functions, utilities', value: '#FF550050' }, // Naranja eléctrico
    { name: 'Configuration', description: 'Config files, settings, constants', value: '#AA00FF50' }, // Púrpura vibrante
    { name: 'Authentication', description: 'Auth logic, JWT, sessions, security', value: '#FF222250' }, // Rojo neón
    { name: 'Testing', description: 'Test cases, testing code', value: '#22FF2250' } // Verde brillante
];

// ============================================================================
// COLOR CONFIGURATION FUNCTIONS
// ============================================================================

/**
 * Gets the available colors from user configuration or defaults
 * Validates color format and filters out invalid entries
 * @returns {Array<{name: string, description: string, value: string}>} Array of valid color objects
 */
function getAvailableColors() {
    const config = vscode.workspace.getConfiguration('codeHighlighter');
    const customColors = config.get('customColors', defaultColors);

    if (!Array.isArray(customColors) || customColors.length === 0) {
        vscode.window.showWarningMessage('Invalid color configuration. Using default colors.');
        return defaultColors;
    }

    const validColors = customColors.filter(color =>
        color &&
        typeof color.name === 'string' &&
        typeof color.value === 'string' &&
        isValidColor(color.value)
    );

    if (validColors.length === 0) {
        vscode.window.showWarningMessage('No valid colors found in configuration. Using default colors.');
        return defaultColors;
    }

    return validColors;
}

/**
 * Gets color metadata (name and description) by color value
 * @param {string} colorValue - Hex color value to search for
 * @returns {{name: string, description: string}|null} Color metadata or null if not found
 */
function getColorMetadata(colorValue) {
    const availableColors = getAvailableColors();
    const color = availableColors.find(c => c.value === colorValue);
    return color ? { name: color.name, description: color.description || '' } : null;
}

/**
 * Creates a darker version of a color for the border
 * @param {string} color - Hex color value
 * @returns {string} Darker hex color value
 */
function getDarkerBorderColor(color) {
    // Remove transparency if present
    const baseColor = color.length === 9 ? color.substring(0, 7) : color;
    
    // Simple darkening by reducing RGB values
    if (baseColor === '#00FFAA') return '#00CC88';
    if (baseColor === '#FF00FF') return '#CC00CC';
    if (baseColor === '#00FFFF') return '#00CCCC';
    if (baseColor === '#FFFF00') return '#CCCC00';
    if (baseColor === '#FF00AA') return '#CC0088';
    if (baseColor === '#00FF00') return '#00CC00';
    if (baseColor === '#FF5500') return '#CC4400';
    if (baseColor === '#AA00FF') return '#8800CC';
    if (baseColor === '#FF2222') return '#CC1A1A';
    if (baseColor === '#22FF22') return '#1ACC1A';
    
    // Default fallback - darken by 20%
    return baseColor;
}

/**
 * Creates decoration type for a given color
 * @param {string} color - Hex color value
 * @returns {vscode.TextEditorDecorationType} Decoration type
 */
function createDecorationType(color) {
    const borderColor = getDarkerBorderColor(color);
    
    return vscode.window.createTextEditorDecorationType({
        backgroundColor: color,
        //borderRadius: '4px',
        border: `2px solid ${borderColor}`,
        borderStyle: 'solid',
        borderWidth: '0 0 0 2px',
        overviewRulerColor: color,
        overviewRulerLane: vscode.OverviewRulerLane.Left,
        // Estas propiedades ayudan a que el borde se aplique al bloque completo
        isWholeLine: false,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    });
}

// ============================================================================
// EXTENSION ACTIVATION
// ============================================================================

/**
 * Extension activation function called by VS Code
 * Registers all commands, event listeners, and initializes the extension
 * @param {vscode.ExtensionContext} ctx - VS Code extension context
 */
function activate(ctx) {
    context = ctx;
    console.log('Code Highlighter activated');

    // Register commands
    let addHighlightCommand = vscode.commands.registerCommand('code-highlighter.addHighlight', addHighlightCommandHandler);
    let clearHighlightsCommand = vscode.commands.registerCommand('code-highlighter.clearHighlights', clearHighlightsCommandHandler);
    let clearAllHighlightsCommand = vscode.commands.registerCommand('code-highlighter.clearAllHighlights', clearAllHighlightsCommandHandler);

    /**
     * Toggle command to show/hide all highlights
     * When enabling, clears memory and reloads from file to sync with any external changes
     */
    let toggleHighlightsCommand = vscode.commands.registerCommand("code-highlighter.toggleHighlights", async () => {
        colorsEnabled = !colorsEnabled;

        if (colorsEnabled) {
            // Clear memory and reload from file to sync with external changes
            highlightDecorations.clear();
            await loadSavedHighlights();
            vscode.window.visibleTextEditors.forEach(editor => {
                applyHighlights(editor);
            });
            vscode.window.showInformationMessage("Code highlights activated");
        } else {
            // Hide all decorations without removing from memory
            vscode.window.visibleTextEditors.forEach(editor => {
                decorationTypes.forEach(decorationType => {
                    editor.setDecorations(decorationType, []);
                });
            });
            vscode.window.showInformationMessage("Code highlights deactivated");
        }

        updateStatusBarButton();
    });

    // Add commands to subscriptions for cleanup on deactivation
    context.subscriptions.push(addHighlightCommand);
    context.subscriptions.push(clearHighlightsCommand);
    context.subscriptions.push(clearAllHighlightsCommand);
    context.subscriptions.push(toggleHighlightsCommand);

    // Create and configure status bar button
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = "code-highlighter.toggleHighlights";
    statusBarItem.tooltip = "Activar/Desactivar code highlights";
    updateStatusBarButton();
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register event listeners
    
    /**
     * Restore highlights when switching between editors
     */
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && colorsEnabled) {
                restoreHighlights(editor);
            }
        })
    );

    /**
     * Restore highlights when opening a document
     */
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(async (document) => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document === document && colorsEnabled) {
                // Pequeño delay para asegurar que el editor esté completamente listo
                setTimeout(() => {
                    restoreHighlights(editor);
                }, 200);
            }
        })
    );

    /**
     * Update highlights when document content changes
     */
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            const editor = vscode.window.activeTextEditor;
            if (editor && event.document === editor.document && colorsEnabled) {
                updateHighlightsForChanges(editor, event);
            }
        })
    );

    /**
     * Clean up highlights when closing a document
     */
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(document => {
            const uri = document.uri.toString();
            highlightDecorations.delete(uri);
        })
    );

    // Load saved highlights and apply them
    initializeHighlights();

    vscode.window.showInformationMessage('Code Highlighter activated. Select text and use command palette to add code highlights.');
}

// ============================================================================
// UI FUNCTIONS
// ============================================================================

/**
 * Updates the status bar button text and color based on toggle state
 */
function updateStatusBarButton() {
    if (colorsEnabled) {
        statusBarItem.text = "$(symbol-color) Highlights ON";
        statusBarItem.color = "#00FF00";
    } else {
        statusBarItem.text = "$(circle-slash) Highlights OFF";
        statusBarItem.color = "#FF5555";
    }
}

/**
 * Initializes highlights on extension startup
 * Loads saved highlights from file and applies them to open editors
 */
async function initializeHighlights() {
    try {
        await loadSavedHighlights();
        // Aplicar highlights a todos los editores visibles
        if (colorsEnabled) {
            vscode.window.visibleTextEditors.forEach(editor => {
                applyHighlights(editor);
            });
        }
    } catch (error) {
        console.error('Error during highlights initialization:', error);
    }
}

// ============================================================================
// COMMAND HANDLERS
// ============================================================================

/**
 * Handler for the 'addHighlight' command
 * Shows a quick pick menu with available colors and handles highlight addition/removal
 */
async function addHighlightCommandHandler() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const selection = editor.selection;
    if (selection.isEmpty) {
        vscode.window.showWarningMessage('Select some text first');
        return;
    }

    const hasHighlightsInSelection = checkHighlightsInSelection(editor, selection);
    const availableColors = getAvailableColors();

    // Build quick pick items with color information
    const colorItems = availableColors.map(color => {
        const descriptionText = color.description ? ` - ${color.description}` : '';
        return {
            label: `$(symbol-color) ${color.name}`,
            description: color.value,
            detail: `${color.name}${descriptionText}`,
            color: color.value,
            colorName: color.name,
            colorDescription: color.description || ''
        };
    });

    // Add remove option if there are highlights in the selection
    if (hasHighlightsInSelection) {
        colorItems.unshift({
            label: '$(clear-all) Remove code highlights in selection',
            description: 'Remove code highlights from selected text',
            detail: 'Removes code highlights that match or contain the selection',
            isClearAction: true
        });
    }

    const selectedOption = await vscode.window.showQuickPick(colorItems, {
        placeHolder: 'Select a color to highlight code or remove existing highlights'
    });

    if (!selectedOption) return;

    if (selectedOption.isClearAction) {
        removeHighlightsInSelection(editor, selection);
        return;
    }

    addHighlight(editor, selection, selectedOption.color, selectedOption.colorName, selectedOption.colorDescription);
}

/**
 * Handler for the 'clearHighlights' command
 * Clears all highlights from the current file
 */
function clearHighlightsCommandHandler() {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        clearHighlights(editor);
        saveHighlights();
        vscode.window.showInformationMessage('Code highlights cleared from current file');
    }
}

/**
 * Handler for the 'clearAllHighlights' command
 * Shows confirmation dialog and clears all highlights from all files
 */
async function clearAllHighlightsCommandHandler() {
    const choice = await vscode.window.showWarningMessage(
        'Delete ALL code highlights from all files?',
        { modal: true },
        'Yes, delete all'
    );

    if (choice === 'Yes, delete all') {
        highlightDecorations.clear();
        vscode.window.visibleTextEditors.forEach(editor => {
            decorationTypes.forEach(decorationType => {
                editor.setDecorations(decorationType, []);
            });
        });

        const highlightsFilePath = getHighlightsFilePath();
        if (highlightsFilePath && fs.existsSync(highlightsFilePath)) {
            try {
                fs.unlinkSync(highlightsFilePath);
                vscode.window.showInformationMessage('All code highlights deleted');
            } catch (error) {
                vscode.window.showErrorMessage(`Error deleting highlights.json: ${error.message}`);
            }
        }
    }
}

// ============================================================================
// HIGHLIGHT MANAGEMENT FUNCTIONS
// ============================================================================

/**
 * Checks if there are any highlights intersecting with the given selection
 * @param {vscode.TextEditor} editor - Current text editor
 * @param {vscode.Selection} selection - Selection to check
 * @returns {boolean} True if highlights exist in selection
 */
function checkHighlightsInSelection(editor, selection) {
    const uri = editor.document.uri.toString();
    const documentHighlights = highlightDecorations.get(uri);
    if (!documentHighlights) return false;

    for (const [color, decorations] of documentHighlights) {
        const hasHighlightInSelection = decorations.some(decoration =>
            selection.intersection(decoration.range) !== undefined
        );
        if (hasHighlightInSelection) return true;
    }
    return false;
}

/**
 * Removes highlights that match or contain the given selection
 * @param {vscode.TextEditor} editor - Current text editor
 * @param {vscode.Selection} selection - Selection containing highlights to remove
 */
function removeHighlightsInSelection(editor, selection) {
    const uri = editor.document.uri.toString();
    const documentHighlights = highlightDecorations.get(uri);
    if (!documentHighlights) return;

    let removedCount = 0;
    documentHighlights.forEach((decorations, color) => {
        const remainingDecorations = decorations.filter(decoration => {
            const exactMatch = decoration.range.start.isEqual(selection.start) &&
                decoration.range.end.isEqual(selection.end);
            const containsSelection = decoration.range.start.isBeforeOrEqual(selection.start) &&
                decoration.range.end.isAfterOrEqual(selection.end);
            if (exactMatch || containsSelection) {
                removedCount++;
                return false;
            }
            return true;
        });
        documentHighlights.set(color, remainingDecorations);
    });

    applyHighlights(editor);
    saveHighlights();

    if (removedCount > 0) {
        vscode.window.showInformationMessage(`Removed ${removedCount} code highlight(s)`);
    } else {
        vscode.window.showInformationMessage('No code highlights found in selection');
    }
}

/**
 * Adds a highlight to the given selection
 * @param {vscode.TextEditor} editor - Current text editor
 * @param {vscode.Selection} selection - Selection to highlight
 * @param {string} color - Hex color value
 * @param {string} colorName - Name of the color/layer
 * @param {string} colorDescription - Description of the color/layer
 */
function addHighlight(editor, selection, color, colorName, colorDescription) {
    const document = editor.document;
    const uri = document.uri.toString();

    if (!isValidColor(color)) {
        vscode.window.showErrorMessage(`Invalid color: ${color}`);
        return;
    }

    // Create or get decoration type for this color
    let decorationType = decorationTypes.get(color);
    if (!decorationType) {
        decorationType = createDecorationType(color);
        decorationTypes.set(color, decorationType);
    }

    // Create decoration object - usar el rango exacto de la selección
    const range = new vscode.Range(selection.start, selection.end);
    const hoverText = colorDescription ? `${colorName}: ${colorDescription}` : colorName;
    const decoration = {
        range,
        hoverMessage: `Code highlight: ${hoverText}`,
        colorName: colorName,
        colorDescription: colorDescription
    };

    // Add to highlights map
    if (!highlightDecorations.has(uri)) {
        highlightDecorations.set(uri, new Map());
    }

    const documentHighlights = highlightDecorations.get(uri);
    if (!documentHighlights.has(color)) {
        documentHighlights.set(color, []);
    }

    // Añadir la nueva decoración
    documentHighlights.get(color).push(decoration);
    
    // Aplicar inmediatamente los highlights visualmente
    applyHighlights(editor);
    
    // Guardar en el archivo (esto hace que persistan sin necesidad de guardar manualmente)
    saveHighlights();
}

/**
 * Applies all highlights to the given editor
 * Only applies if highlights are enabled
 * @param {vscode.TextEditor} editor - Editor to apply highlights to
 */
function applyHighlights(editor) {
    if (!colorsEnabled) return;

    const uri = editor.document.uri.toString();
    const documentHighlights = highlightDecorations.get(uri);
    
    // Primero limpiar todas las decoraciones existentes
    decorationTypes.forEach((decorationType) => {
        editor.setDecorations(decorationType, []);
    });

    // Si no hay highlights para este documento, terminar aquí
    if (!documentHighlights || documentHighlights.size === 0) {
        return;
    }

    // Aplicar highlights por color
    documentHighlights.forEach((decorations, color) => {
        let decorationType = decorationTypes.get(color);
        if (!decorationType) {
            decorationType = createDecorationType(color);
            decorationTypes.set(color, decorationType);
        }
        
        // Aplicar todas las decoraciones de este color
        editor.setDecorations(decorationType, decorations);
    });
}

/**
 * Clears all highlights from the given editor
 * @param {vscode.TextEditor} editor - Editor to clear highlights from
 */
function clearHighlights(editor) {
    const uri = editor.document.uri.toString();
    const documentHighlights = highlightDecorations.get(uri);
    if (!documentHighlights) return;

    decorationTypes.forEach((decorationType) => {
        editor.setDecorations(decorationType, []);
    });

    highlightDecorations.delete(uri);
}

/**
 * Updates highlights after document changes
 * Reapplies highlights and saves to file
 * @param {vscode.TextEditor} editor - Editor with changes
 * @param {vscode.TextDocumentChangeEvent} event - Change event
 */
function updateHighlightsForChanges(editor, event) {
    if (!colorsEnabled) return;
    applyHighlights(editor);
    saveHighlights();
}

/**
 * Restores highlights when switching to an editor
 * @param {vscode.TextEditor} editor - Editor to restore highlights in
 */
function restoreHighlights(editor) {
    if (!colorsEnabled) return;
    applyHighlights(editor);
}

// ============================================================================
// FILE SYSTEM FUNCTIONS
// ============================================================================

/**
 * Gets the workspace root path
 * @returns {string|null} Workspace root path or null if not available
 */
function getWorkspaceRoot() {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        return vscode.workspace.workspaceFolders[0].uri.fsPath;
    }
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        return path.dirname(activeEditor.document.uri.fsPath);
    }
    return null;
}

/**
 * Gets the path to the highlights.json file
 * @returns {string|null} Path to highlights file or null if workspace not available
 */
function getHighlightsFilePath() {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) return null;
    return path.join(workspaceRoot, 'highlights.json');
}

/**
 * Saves all highlights to highlights.json file
 * Includes color metadata if enabled in settings
 */
function saveHighlights() {
    const highlightsFilePath = getHighlightsFilePath();
    if (!highlightsFilePath) return;

    const config = vscode.workspace.getConfiguration('codeHighlighter');
    const saveMetadata = config.get('saveColorMetadata', true);

    const highlightsData = { files: {} };
    
    highlightDecorations.forEach((colorMap, uri) => {
        const workspaceRoot = getWorkspaceRoot();
        let relativePath = uri;
        
        // Convert absolute path to relative path
        if (workspaceRoot && uri.startsWith('file://')) {
            const absolutePath = vscode.Uri.parse(uri).fsPath;
            relativePath = path.relative(workspaceRoot, absolutePath);
        }
        
        const fileHighlights = {};
        colorMap.forEach((decorations, color) => {
            const colorData = decorations.map(decoration => {
                const baseData = {
                    startLine: decoration.range.start.line,
                    startCharacter: decoration.range.start.character,
                    endLine: decoration.range.end.line,
                    endCharacter: decoration.range.end.character
                };

                // Add metadata if enabled
                if (saveMetadata) {
                    const metadata = decoration.colorName ?
                        { name: decoration.colorName, description: decoration.colorDescription || '' } :
                        getColorMetadata(color);

                    if (metadata) {
                        baseData.name = metadata.name;
                        if (metadata.description) {
                            baseData.description = metadata.description;
                        }
                    }
                }

                return baseData;
            });
            fileHighlights[color] = colorData;
        });
        highlightsData.files[relativePath] = fileHighlights;
    });

    try {
        fs.writeFileSync(highlightsFilePath, JSON.stringify(highlightsData, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving highlights:', error);
    }
}

/**
 * Loads saved highlights from highlights.json file and applies them
 * @returns {Promise<void>} Promise that resolves when loading is complete
 */
function loadSavedHighlights() {
    return new Promise((resolve) => {
        const highlightsFilePath = getHighlightsFilePath();
        if (!highlightsFilePath || !fs.existsSync(highlightsFilePath)) {
            resolve();
            return;
        }
        
        try {
            const jsonContent = fs.readFileSync(highlightsFilePath, 'utf8');
            const savedHighlights = JSON.parse(jsonContent);
            const workspaceRoot = getWorkspaceRoot();
            
            Object.keys(savedHighlights.files).forEach(relativePath => {
                let uri = vscode.Uri.file(path.resolve(workspaceRoot, relativePath)).toString();
                const colorMap = new Map();
                const fileData = savedHighlights.files[relativePath];
                
                Object.keys(fileData).forEach(color => {
                    const decorations = fileData[color].map(decData => {
                        const start = new vscode.Position(decData.startLine, decData.startCharacter);
                        const end = new vscode.Position(decData.endLine, decData.endCharacter);

                        // Load metadata if available
                        const colorName = decData.name || 'Code highlight';
                        const colorDescription = decData.description || '';
                        const hoverText = colorDescription ? `${colorName}: ${colorDescription}` : colorName;

                        return {
                            range: new vscode.Range(start, end),
                            hoverMessage: `Code highlight: ${hoverText}`,
                            colorName: colorName,
                            colorDescription: colorDescription
                        };
                    });
                    colorMap.set(color, decorations);
                });
                highlightDecorations.set(uri, colorMap);
                
                // Aplicar los highlights inmediatamente después de cargarlos
                const editor = vscode.window.visibleTextEditors.find(
                    e => e.document.uri.toString() === uri
                );
                if (editor && colorsEnabled) {
                    applyHighlights(editor);
                }
            });
            resolve();
        } catch (error) {
            console.error('Error loading highlights.json:', error);
            resolve();
        }
    });
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validates if a color string is a valid hex color
 * Accepts 6 digits (RGB) or 8 digits (RGBA) with # prefix
 * @param {string} color - Color string to validate
 * @returns {boolean} True if valid hex color
 */
function isValidColor(color) {
    return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/.test(color);
}

// ============================================================================
// EXTENSION DEACTIVATION
// ============================================================================

/**
 * Extension deactivation function called by VS Code
 * Saves highlights and cleans up resources
 */
function deactivate() {
    saveHighlights();
    decorationTypes.forEach(decorationType => {
        decorationType.dispose();
    });
    decorationTypes.clear();
    highlightDecorations.clear();
}

// ============================================================================
// MODULE EXPORTS
// ============================================================================

module.exports = {
    activate,
    deactivate
};
