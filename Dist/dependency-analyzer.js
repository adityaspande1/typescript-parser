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
function analyzeReactComponent(sourceFile, typeChecker) {
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
            // Handle interface declaration
            if (ts.isInterfaceDeclaration(node)) {
                members = node.members;
            }
            // Handle type alias declaration (must be a TypeLiteral)
            else if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
                members = node.type.members;
            }
            if (members) {
                members.forEach(member => {
                    if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
                        const propName = member.name.getText();
                        const propType = member.type ? member.type.getText() : 'any';
                        const isRequired = !member.questionToken;
                        componentInfo.props.push({
                            name: propName,
                            type: propType,
                            isRequired: isRequired
                        });
                    }
                });
            }
        }
    }
    function analyzeNode(node) {
        if (ts.isFunctionDeclaration(node) || ts.isVariableStatement(node)) {
            let componentName = '';
            if (ts.isFunctionDeclaration(node) && node.name) {
                componentName = node.name.text;
            }
            else if (ts.isVariableStatement(node) &&
                node.declarationList.declarations.length > 0) {
                const declaration = node.declarationList.declarations[0];
                if (ts.isIdentifier(declaration.name)) {
                    componentName = declaration.name.text;
                }
            }
            if (componentName && /^[A-Z]/.test(componentName)) {
                componentInfo.componentName = componentName;
                componentInfo.isExported = hasExportKeyword(node);
            }
        }
        if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
            analyzePropsInterface(node);
        }
        analyzeHooks(node);
        ts.forEachChild(node, analyzeNode);
    }
    function hasExportKeyword(node) {
        return !!(ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export);
    }
    checkUseClientDirective(sourceFile);
    analyzeNode(sourceFile);
    return componentInfo.componentName ? componentInfo : null;
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
function analyzeProject(projectPath) {
    const filePaths = fs
        .readdirSync(projectPath)
        .filter((file) => file.endsWith('.tsx') || file.endsWith('.ts'))
        .map((file) => path.join(projectPath, file));
    const program = ts.createProgram(filePaths, {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.React,
    });
    const typeChecker = program.getTypeChecker();
    const sourceFiles = program.getSourceFiles();
    const components = [];
    sourceFiles.forEach((sourceFile) => {
        if (!sourceFile.isDeclarationFile && sourceFile.fileName.includes(projectPath)) {
            const componentAnalysis = analyzeReactComponent(sourceFile, typeChecker);
            if (componentAnalysis) {
                componentAnalysis.usedInComponents = findComponentUsage(sourceFiles, componentAnalysis.componentName);
                components.push(componentAnalysis);
            }
        }
    });
    fs.writeFileSync('component-analysis.json', JSON.stringify(components, null, 2));
}
const projectPath = '/Users/adityapande/Desktop/trial-project/src'; // Update this with the correct project path
analyzeProject(projectPath);
