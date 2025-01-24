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
function extractDependencies(projectPath) {
    // Get all TypeScript files in the project
    const tsFiles = getAllTypeScriptFiles(projectPath);
    const dependencies = {};
    // Create program with all TypeScript files
    const program = ts.createProgram(tsFiles, {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS
    });
    const typeChecker = program.getTypeChecker();
    tsFiles.forEach(filePath => {
        const sourceFile = program.getSourceFile(filePath);
        if (sourceFile && !sourceFile.isDeclarationFile) {
            const fileName = path.basename(filePath);
            dependencies[fileName] = {
                fileName: fileName,
                importedFrom: [],
                exportedTo: [],
                importedFunctions: []
            };
            // Analyze imports
            sourceFile.forEachChild(node => {
                if (ts.isImportDeclaration(node)) {
                    // Extract import path
                    const importPath = node.moduleSpecifier.getText().replace(/['"]/g, '');
                    const resolvedImportPath = resolveImportPath(projectPath, filePath, importPath);
                    const importedFileName = path.basename(resolvedImportPath);
                    if (importedFileName !== fileName) {
                        dependencies[fileName].importedFrom.push(importedFileName);
                    }
                    // Extract imported functions/types
                    if (node.importClause) {
                        if (node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
                            node.importClause.namedBindings.elements.forEach(importSpecifier => {
                                var _a;
                                dependencies[fileName].importedFunctions.push(((_a = importSpecifier.propertyName) === null || _a === void 0 ? void 0 : _a.getText()) || importSpecifier.name.getText());
                            });
                        }
                    }
                }
            });
        }
    });
    tsFiles.forEach(filePath => {
        const fileName = path.basename(filePath);
        tsFiles.forEach(checkFilePath => {
            const checkFileName = path.basename(checkFilePath);
            if (fileName !== checkFileName) {
                const content = fs.readFileSync(checkFilePath, 'utf-8');
                if (content.includes(`from './${fileName}'`) ||
                    content.includes(`from "${fileName}"`) ||
                    content.includes(`from './${path.basename(fileName, '.ts')}'`) ||
                    content.includes(`from "${path.basename(fileName, '.ts')}"`)) {
                    dependencies[fileName].exportedTo.push(checkFileName);
                }
            }
        });
    });
    return dependencies;
}
function getAllTypeScriptFiles(dirPath) {
    const tsFiles = [];
    function traverseDirectory(currentPath) {
        const files = fs.readdirSync(currentPath);
        files.forEach(file => {
            const fullPath = path.join(currentPath, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                traverseDirectory(fullPath);
            }
            else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
                tsFiles.push(fullPath);
            }
        });
    }
    traverseDirectory(dirPath);
    return tsFiles;
}
function resolveImportPath(projectPath, currentFile, importPath) {
    // Handle relative imports
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
        return path.resolve(path.dirname(currentFile), importPath + (importPath.endsWith('.ts') ? '' : '.ts'));
    }
    // Handle absolute imports within project
    return path.join(projectPath, importPath + '.ts');
}
function saveToJsonFile(data, outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    console.log(`Dependency analysis saved to ${outputPath}`);
}
// Usage
const projectPath = '/Users/adityapande/Desktop/trial-project/src';
const dependencyMap = extractDependencies(projectPath);
saveToJsonFile(dependencyMap, 'dependency-map.json');
