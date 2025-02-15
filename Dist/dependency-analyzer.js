"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const ts = __importStar(require("typescript"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Helper function to check if a node is exported
function hasExportModifier(node) {
    var _a, _b;
    if (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isVariableStatement(node)) {
        return ((_b = (_a = node.modifiers) === null || _a === void 0 ? void 0 : _a.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) !== null && _b !== void 0 ? _b : false);
    }
    return false;
}
function analyzeReactComponent(sourceFile, typeChecker) {
    console.log(`\nAnalyzing file: ${sourceFile.fileName}`);
    let componentInfo = {
        fileName: path.basename(sourceFile.fileName),
        componentName: '',
        isClientComponent: false,
        isServerComponent: false,
        isExported: false,
        props: [],
        hooks: {
            useState: [],
            useEffect: false,
            useCallback: false,
            useMemo: false,
            useRef: false,
            customHooks: [],
        },
        states: [],
        usedInComponents: [],
    };
    // Check for the "use client" directive at the top of the file.
    function checkUseClientDirective(node) {
        const firstStatement = node.statements[0];
        if (firstStatement &&
            ts.isExpressionStatement(firstStatement) &&
            ts.isStringLiteral(firstStatement.expression) &&
            firstStatement.expression.text === 'use client') {
            componentInfo.isClientComponent = true;
        }
    }
    function analyzeHooks(node) {
        if (ts.isCallExpression(node)) {
            const expression = node.expression;
            if (ts.isIdentifier(expression)) {
                const hookName = expression.text;
                if (hookName === 'useState') {
                    analyzeUseState(node);
                }
                else if (hookName === 'useEffect') {
                    componentInfo.hooks.useEffect = true;
                }
                else if (hookName === 'useCallback') {
                    componentInfo.hooks.useCallback = true;
                }
                else if (hookName === 'useMemo') {
                    componentInfo.hooks.useMemo = true;
                }
                else if (hookName === 'useRef') {
                    componentInfo.hooks.useRef = true;
                }
                else if (hookName.startsWith('use')) {
                    componentInfo.hooks.customHooks.push(hookName);
                }
            }
        }
        ts.forEachChild(node, analyzeHooks);
    }
    function analyzeUseState(node) {
        if (node.parent && ts.isVariableDeclaration(node.parent)) {
            // console.log("Node name",node.parent.name);
            const declaration = node.parent;
            if (ts.isArrayBindingPattern(declaration.name)) {
                const stateName = declaration.name.elements[0].getText();
                const typeNode = typeChecker.getTypeAtLocation(node);
                const stateType = typeChecker.typeToString(typeNode) || 'unknown';
                let initialValue = 'undefined';
                if (node.arguments.length > 0) {
                    initialValue = node.arguments[0].getText();
                }
                componentInfo.states.push({
                    name: stateName,
                    type: stateType,
                    initialValue: initialValue,
                });
                componentInfo.hooks.useState.push(stateName);
            }
        }
    }
    function analyzePropsInterface(node) {
        if (node.name.getText().includes('Props')) {
            let members;
            if (ts.isInterfaceDeclaration(node)) {
                members = node.members;
            }
            else if (ts.isTypeAliasDeclaration(node) &&
                ts.isTypeLiteralNode(node.type)) {
                members = node.type.members;
            }
            if (members) {
                members.forEach((member) => {
                    if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
                        const propName = member.name.getText();
                        const propType = member.type ? member.type.getText() : 'any';
                        const isRequired = !member.questionToken;
                        componentInfo.props.push({
                            name: propName,
                            type: propType,
                            isRequired: isRequired,
                        });
                    }
                });
            }
        }
    }
    function analyzeNode(node) {
        // Check function declarations
        if (ts.isFunctionDeclaration(node) && node.name) {
            const symbol = typeChecker.getSymbolAtLocation(node.name);
            if (symbol) {
                componentInfo.componentName = symbol.getName();
                componentInfo.isExported = hasExportModifier(node);
            }
        }
        // Check variable statements (for arrow function components)
        if (ts.isVariableStatement(node)) {
            node.declarationList.declarations.forEach((declaration) => {
                if (ts.isVariableDeclaration(declaration) &&
                    declaration.initializer &&
                    ts.isArrowFunction(declaration.initializer)) {
                    const symbol = typeChecker.getSymbolAtLocation(declaration.name);
                    if (symbol) {
                        componentInfo.componentName = symbol.getName();
                        componentInfo.isExported = hasExportModifier(node);
                    }
                }
            });
        }
        if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
            analyzePropsInterface(node);
        }
        analyzeHooks(node);
        ts.forEachChild(node, analyzeNode);
    }
    try {
        checkUseClientDirective(sourceFile);
        analyzeNode(sourceFile);
    }
    catch (error) {
        console.error(`Error analyzing component in ${sourceFile.fileName}:`, error);
    }
    return componentInfo; // Always return an object, even if empty.
}
function findComponentUsage(sourceFiles, componentName) {
    const usedIn = [];
    sourceFiles.forEach((sourceFile) => {
        let isUsed = false;
        ts.forEachChild(sourceFile, (node) => {
            if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
                const tagName = ts.isJsxElement(node)
                    ? node.openingElement.tagName.getText()
                    : node.tagName.getText();
                if (tagName === componentName) {
                    isUsed = true;
                }
            }
        });
        if (isUsed) {
            usedIn.push(path.basename(sourceFile.fileName));
        }
    });
    return usedIn;
}
function getAllFiles(dir) {
    console.log(`Scanning directory: ${dir}`);
    let files = [];
    try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                // Skiping  node_modules and hidden directories
                if (item !== 'node_modules' && !item.startsWith('.')) {
                    files = files.concat(getAllFiles(fullPath));
                }
            }
            else if (stat.isFile() &&
                (item.endsWith('.tsx') || item.endsWith('.ts')) &&
                !item.endsWith('.d.ts')) {
                console.log(`Found TypeScript file: ${fullPath}`);
                files.push(fullPath);
            }
        }
    }
    catch (error) {
        console.error(`Error scanning directory ${dir}:`, error);
    }
    return files;
}
function analyzeProject(projectPath) {
    console.log(`\n=== React Component Analyzer ===`);
    console.log(`Starting analysis of project at path: ${projectPath}\n`);
    // Verify directory exists
    if (!fs.existsSync(projectPath)) {
        console.error(`Error: Directory ${projectPath} does not exist`);
        return;
    }
    // Get all TypeScript files recursively
    const filePaths = getAllFiles(projectPath);
    console.log(`\nFound ${filePaths.length} TypeScript/TSX files`);
    if (filePaths.length === 0) {
        console.error('No TypeScript/TSX files found in the project directory');
        return;
    }
    // Create compiler options
    const compilerOptions = {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        allowJs: true,
        skipLibCheck: true,
    };
    let program;
    try {
        program = ts.createProgram(filePaths, compilerOptions);
        console.log('TypeScript program created successfully');
    }
    catch (error) {
        console.error('Error creating TypeScript program:', error);
        return;
    }
    const typeChecker = program.getTypeChecker();
    const sourceFiles = program.getSourceFiles();
    const components = [];
    console.log(`\nAnalyzing ${sourceFiles.length} source files...`);
    sourceFiles.forEach((sourceFile) => {
        if (!sourceFile.isDeclarationFile) {
            try {
                const componentAnalysis = analyzeReactComponent(sourceFile, typeChecker);
                componentAnalysis.usedInComponents = findComponentUsage(sourceFiles, componentAnalysis.componentName);
                components.push(componentAnalysis); // Always push, even if no component is found.
            }
            catch (error) {
                console.error(`Error analyzing file ${sourceFile.fileName}:`, error);
            }
        }
    });
    console.log(`\nAnalysis complete. Found ${components.length} files analyzed.`);
    try {
        const outputPath = path.join(process.cwd(), 'component-analysis1.json');
        fs.writeFileSync(outputPath, JSON.stringify(components, null, 2));
        console.log(`Results written to: ${outputPath}`);
    }
    catch (error) {
        console.error('Error writing results to file:', error);
    }
}
// Main execution with command line argument support and error handling
try {
    // Use command line argument if provided, otherwise use default path
    const projectPath1 = '/Users/adityapande/Desktop/trial-project/src';
    const projectPath = '/Users/adityapande/Desktop/Personal/AdityaPande';
    // '/Users/adityapande/Desktop/Extension/Dependency-Analysis-Extension/src';
    analyzeProject(projectPath);
}
catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
}
