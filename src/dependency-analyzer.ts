import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

interface FileDependency {
  fileName: string;
  importedFrom: string[];
  exportedTo: string[];
  importedFunctions: string[];
}

function extractDependencies(projectPath: string): Record<string, FileDependency> {
  // Get all TypeScript files in the project
  const tsFiles = getAllTypeScriptFiles(projectPath);

  const dependencies: Record<string, FileDependency> = {};

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
                dependencies[fileName].importedFunctions.push(
                  importSpecifier.propertyName?.getText() || importSpecifier.name.getText()
                );
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
            content.includes(`from "${path.basename(fileName, '.ts')}"`)
        ) {
          dependencies[fileName].exportedTo.push(checkFileName);
        }
      }
    });
  });

  return dependencies;
}

function getAllTypeScriptFiles(dirPath: string): string[] {
  const tsFiles: string[] = [];

  function traverseDirectory(currentPath: string) {
    const files = fs.readdirSync(currentPath);

    files.forEach(file => {
      const fullPath = path.join(currentPath, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        traverseDirectory(fullPath);
      } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
        tsFiles.push(fullPath);
      }
    });
  }

  traverseDirectory(dirPath);
  return tsFiles;
}

function resolveImportPath(projectPath: string, currentFile: string, importPath: string): string {
  // Handle relative imports
  if (importPath.startsWith('./') || importPath.startsWith('../')) {
    return path.resolve(path.dirname(currentFile), importPath + (importPath.endsWith('.ts') ? '' : '.ts'));
  }
  
  // Handle absolute imports within project
  return path.join(projectPath, importPath + '.ts');
}

function saveToJsonFile(data: Record<string, FileDependency>, outputPath: string) {
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  console.log(`Dependency analysis saved to ${outputPath}`);
}

// Usage
const projectPath = '/Users/adityapande/Desktop/trial-project/src';
const dependencyMap = extractDependencies(projectPath);
saveToJsonFile(dependencyMap, 'dependency-map.json');