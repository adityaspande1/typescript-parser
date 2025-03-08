import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

// Enhanced interface for file analysis
interface FileAnalysis {
  fileName: string;
  filePath: string;
  exports: {
    components: ComponentInfo[];
    functions: FunctionInfo[];
    interfaces: InterfaceInfo[];
    types: TypeInfo[];
    classes: ClassInfo[];
    variables: VariableInfo[];
  };
  imports: ImportInfo[];
  // Dependencies tracking
  incomingDependencies: string[]; // Files that import this file
  outgoingDependencies: string[]; // Files this file imports
  usedByComponents: string[]; // Components that use this file's exports
}

interface ComponentInfo {
  name: string;
  type: 'function' | 'class' | 'arrow'; // Type of component
  isExported: boolean;
  isClientComponent: boolean;
  isServerComponent: boolean;
  props: PropInfo[];
  hooks: {
    useState: StateInfo[];
    useEffect: boolean;
    useCallback: boolean;
    useMemo: boolean;
    useRef: boolean;
    customHooks: string[];
  };
  usedComponents: string[]; // Other components used within this component
  usedInFiles: string[]; // Files where this component is used
}

interface FunctionInfo {
  name: string;
  isExported: boolean;
  params: ParameterInfo[];
  returnType: string;
  usedInFiles: string[]; // Files where this function is used
}

interface ParameterInfo {
  name: string;
  type: string;
  isRequired: boolean;
}

interface PropInfo {
  name: string;
  type: string;
  isRequired: boolean;
}

interface StateInfo {
  name: string;
  type: string;
  initialValue: string;
}

interface InterfaceInfo {
  name: string;
  isExported: boolean;
  properties: PropertyInfo[];
  usedInFiles: string[]; // Files where this interface is used
}

interface PropertyInfo {
  name: string;
  type: string;
  isRequired: boolean;
}

interface TypeInfo {
  name: string;
  isExported: boolean;
  type: string;
  usedInFiles: string[]; // Files where this type is used
}

interface ClassInfo {
  name: string;
  isExported: boolean;
  methods: MethodInfo[];
  properties: PropertyInfo[];
  usedInFiles: string[]; // Files where this class is used
}

interface MethodInfo {
  name: string;
  params: ParameterInfo[];
  returnType: string;
}

interface VariableInfo {
  name: string;
  isExported: boolean;
  type: string;
  usedInFiles: string[]; // Files where this variable is used
}

interface ImportInfo {
  name: string;
  path: string;
  namedImports: string[];
  defaultImport: string;
  isTypeOnly: boolean;
  resolvedFilePath?: string; // Actual file path resolved from the import
}
// Helper function to check export modifiers
function hasExportModifier(node: ts.HasModifiers): boolean {
  return (
    (ts.getModifiers(node)?.some(
      (modifier: ts.Modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
    )) ?? false
  );
}

// Helper function to check default export modifiers
function hasDefaultExportModifier(node: ts.HasModifiers): boolean {
  return (
    (ts.getModifiers(node)?.some(
      (modifier: ts.Modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword
    )) ?? false
  );
}

// Helper function to get the type string from a node
function getTypeAsString(
  node: ts.Node,
  typeChecker: ts.TypeChecker
): string {
  try {
    const type = typeChecker.getTypeAtLocation(node);
    return typeChecker.typeToString(type);
  } catch (error) {
    return 'unknown';
  }
}

// Helper function to resolve import paths to actual file paths
function resolveImportPath(
  importPath: string,
  currentFilePath: string,
  compilerOptions: ts.CompilerOptions
): string | undefined {
  try {
    // Handle relative paths
    if (importPath.startsWith('.')) {
      const resolvedPath = path.resolve(path.dirname(currentFilePath), importPath);
      
      // Try with various extensions
      const extensions = ['.ts', '.tsx', '.js', '.jsx'];
      for (const ext of extensions) {
        const fullPath = resolvedPath + ext;
        if (fs.existsSync(fullPath)) {
          return fullPath;
        }
      }
      
      // Check if it might be a directory with an index file
      for (const ext of extensions) {
        const indexPath = path.join(resolvedPath, `index${ext}`);
        if (fs.existsSync(indexPath)) {
          return indexPath;
        }
      }
    }
    
    // For npm packages or absolute paths, we can't resolve easily in this context
    return undefined;
  } catch (error) {
    console.error(`Error resolving import path ${importPath}:`, error);
    return undefined;
  }
}

// Function to analyze a single file
function analyzeFile(
  sourceFile: ts.SourceFile,
  typeChecker: ts.TypeChecker,
  program: ts.Program,
  compilerOptions: ts.CompilerOptions
): FileAnalysis {
  console.log(`Analyzing file: ${sourceFile.fileName}`);
  
  const fileInfo: FileAnalysis = {
    fileName: path.basename(sourceFile.fileName),
    filePath: sourceFile.fileName,
    exports: {
      components: [],
      functions: [],
      interfaces: [],
      types: [],
      classes: [],
      variables: []
    },
    imports: [],
    incomingDependencies: [],
    outgoingDependencies: [],
    usedByComponents: []
  };

  // Check for "use client" directive
  function checkUseClientDirective(node: ts.SourceFile): boolean {
    const firstStatement = node.statements[0];
    if (
      firstStatement &&
      ts.isExpressionStatement(firstStatement) &&
      ts.isStringLiteral(firstStatement.expression) &&
      firstStatement.expression.text === 'use client'
    ) {
      return true;
    }
    return false;
  }

  // Process imports
  function analyzeImports(node: ts.ImportDeclaration): void {
    // Skip type-only imports if we're not interested in them
    const isTypeOnly = node.importClause?.isTypeOnly || false;
    
    // Get module specifier text
    if (ts.isStringLiteral(node.moduleSpecifier)) {
      const importPath = node.moduleSpecifier.text;
      const resolvedPath = resolveImportPath(
        importPath,
        sourceFile.fileName,
        compilerOptions
      );
      
      if (resolvedPath) {
        fileInfo.outgoingDependencies.push(resolvedPath);
      }
      
      const importInfo: ImportInfo = {
        name: path.basename(importPath, path.extname(importPath)),
        path: importPath,
        namedImports: [],
        defaultImport: '',
        isTypeOnly,
        resolvedFilePath: resolvedPath
      };
      
      // Get default import
      if (node.importClause?.name) {
        importInfo.defaultImport = node.importClause.name.text;
      }
      
      // Get named imports
      if (node.importClause?.namedBindings) {
        if (ts.isNamedImports(node.importClause.namedBindings)) {
          node.importClause.namedBindings.elements.forEach((element) => {
            const importName = element.name.text;
            if (element.propertyName) {
              // Handle renamed imports (e.g., import { X as Y })
              importInfo.namedImports.push(
                `${element.propertyName.text} as ${importName}`
              );
            } else {
              importInfo.namedImports.push(importName);
            }
          });
        } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
          // Handle namespace imports (e.g., import * as X)
          importInfo.namedImports.push(
            `* as ${node.importClause.namedBindings.name.text}`
          );
        }
      }
      
      fileInfo.imports.push(importInfo);
    }
  }

  // Process function declarations
  function analyzeFunctionDeclaration(node: ts.FunctionDeclaration): void {
    if (!node.name) return;
    
    // Extract function name
    const functionName = node.name.text;
    const isExported = hasExportModifier(node);
    const isDefaultExport = hasDefaultExportModifier(node);
    
    // Extract parameters
    const params = node.parameters.map((param): ParameterInfo => {
      const paramName = param.name.getText();
      const paramType = param.type 
        ? param.type.getText() 
        : getTypeAsString(param, typeChecker);
      const isRequired = !param.questionToken;
      
      return {
        name: paramName,
        type: paramType,
        isRequired
      };
    });
    
    // Extract return type
    const returnType = node.type 
      ? node.type.getText() 
      : getTypeAsString(node, typeChecker);
    
    // Check if it's a React component
    const isComponent = 
      returnType.includes('JSX.Element') || 
      returnType.includes('React.ReactElement') ||
      returnType.includes('ReactNode');
    
    if (isComponent) {
      // Handle React component
      const componentInfo: ComponentInfo = {
        name: functionName,
        type: 'function',
        isExported: isExported || isDefaultExport,
        isClientComponent: checkUseClientDirective(sourceFile),
        isServerComponent: !checkUseClientDirective(sourceFile),
        props: [],
        hooks: {
          useState: [],
          useEffect: false,
          useCallback: false,
          useMemo: false,
          useRef: false,
          customHooks: []
        },
        usedComponents: [],
        usedInFiles: []
      };
      
      // Extract props from parameters
      if (node.parameters.length > 0) {
        const propsParam = node.parameters[0];
        
        if (propsParam.type && ts.isTypeReferenceNode(propsParam.type)) {
          const propsTypeName = propsParam.type.typeName.getText();
          
          // Find the corresponding interface
          const propsInterface = findInterface(propsTypeName);
          if (propsInterface) {
            componentInfo.props = propsInterface.properties;
          }
        }
      }
      
      // Parse function body for hooks and used components
      if (node.body) {
        analyzeNodeForHooksAndComponents(node.body, componentInfo);
      }
      
      fileInfo.exports.components.push(componentInfo);
    } else {
      // Handle regular function
      const functionInfo: FunctionInfo = {
        name: functionName,
        isExported: isExported || isDefaultExport,
        params,
        returnType,
        usedInFiles: []
      };
      
      fileInfo.exports.functions.push(functionInfo);
    }
  }

  // Find interface by name
  function findInterface(name: string): InterfaceInfo | undefined {
    return fileInfo.exports.interfaces.find(i => i.name === name);
  }

  // Process variable declarations (including arrow function components)
  function analyzeVariableDeclaration(node: ts.VariableStatement): void {
    const isExported = hasExportModifier(node);
    
    node.declarationList.declarations.forEach(declaration => {
      if (!ts.isIdentifier(declaration.name)) return;
      
      const variableName = declaration.name.text;
      let variableType = 'unknown';
      
      if (declaration.type) {
        variableType = declaration.type.getText();
      } else if (declaration.initializer) {
        variableType = getTypeAsString(declaration.initializer, typeChecker);
      }
      
      // Check if it's a React component (arrow function)
      if (
        declaration.initializer && 
        (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
      ) {
        const returnType = getTypeAsString(declaration.initializer, typeChecker);
        const isComponent = 
          returnType.includes('JSX.Element') || 
          returnType.includes('React.ReactElement') ||
          returnType.includes('ReactNode');
        
        if (isComponent) {
          const componentInfo: ComponentInfo = {
            name: variableName,
            type: 'arrow',
            isExported: isExported,
            isClientComponent: checkUseClientDirective(sourceFile),
            isServerComponent: !checkUseClientDirective(sourceFile),
            props: [],
            hooks: {
              useState: [],
              useEffect: false,
              useCallback: false,
              useMemo: false,
              useRef: false,
              customHooks: []
            },
            usedComponents: [],
            usedInFiles: []
          };
          
          // Extract props from parameters
          if (ts.isArrowFunction(declaration.initializer)) {
            const arrowFunc = declaration.initializer;
            
            if (arrowFunc.parameters.length > 0) {
              const propsParam = arrowFunc.parameters[0];
              
              if (propsParam.type && ts.isTypeReferenceNode(propsParam.type)) {
                const propsTypeName = propsParam.type.typeName.getText();
                
                // Find the corresponding interface
                const propsInterface = findInterface(propsTypeName);
                if (propsInterface) {
                  componentInfo.props = propsInterface.properties;
                }
              }
            }
            
            // Parse function body for hooks and used components
            if (arrowFunc.body) {
              analyzeNodeForHooksAndComponents(arrowFunc.body, componentInfo);
            }
          }
          
          fileInfo.exports.components.push(componentInfo);
        } else {
          // Just a regular arrow function
          const functionInfo: FunctionInfo = {
            name: variableName,
            isExported: isExported,
            params: [],
            returnType: variableType,
            usedInFiles: []
          };
          
          fileInfo.exports.functions.push(functionInfo);
        }
      } else {
        // Regular variable
        const variableInfo: VariableInfo = {
          name: variableName,
          isExported: isExported,
          type: variableType,
          usedInFiles: []
        };
        
        fileInfo.exports.variables.push(variableInfo);
      }
    });
  }

  // Process interface declarations
  function analyzeInterfaceDeclaration(node: ts.InterfaceDeclaration): void {
    const interfaceName = node.name.text;
    const isExported = hasExportModifier(node);
    
    const properties: PropertyInfo[] = node.members.map(member => {
      if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
        const propName = member.name.getText();
        const propType = member.type 
          ? member.type.getText() 
          : 'any';
        const isRequired = !member.questionToken;
        
        return {
          name: propName,
          type: propType,
          isRequired
        };
      }
      
      return {
        name: 'unknown',
        type: 'unknown',
        isRequired: false
      };
    }).filter(prop => prop.name !== 'unknown');
    
    const interfaceInfo: InterfaceInfo = {
      name: interfaceName,
      isExported,
      properties,
      usedInFiles: []
    };
    
    fileInfo.exports.interfaces.push(interfaceInfo);
  }

  // Process type alias declarations
  function analyzeTypeDeclaration(node: ts.TypeAliasDeclaration): void {
    const typeName = node.name.text;
    const isExported = hasExportModifier(node);
    const typeValue = node.type.getText();
    
    const typeInfo: TypeInfo = {
      name: typeName,
      isExported,
      type: typeValue,
      usedInFiles: []
    };
    
    fileInfo.exports.types.push(typeInfo);
  }

  // Process class declarations
  function analyzeClassDeclaration(node: ts.ClassDeclaration): void {
    if (!node.name) return;
    
    const className = node.name.text;
    const isExported = hasExportModifier(node);
    
    const properties: PropertyInfo[] = [];
    const methods: MethodInfo[] = [];
    
    // Process class members
    node.members.forEach(member => {
      // Property declarations
      if (ts.isPropertyDeclaration(member)) {
        if (ts.isIdentifier(member.name)) {
          const propName = member.name.text;
          const propType = member.type 
            ? member.type.getText() 
            : getTypeAsString(member, typeChecker);
          const isRequired = !member.questionToken;
          
          properties.push({
            name: propName,
            type: propType,
            isRequired
          });
        }
      }
      
      // Method declarations
      if (ts.isMethodDeclaration(member)) {
        if (ts.isIdentifier(member.name)) {
          const methodName = member.name.text;
          
          // Extract parameters
          const params = member.parameters.map((param): ParameterInfo => {
            const paramName = param.name.getText();
            const paramType = param.type 
              ? param.type.getText() 
              : getTypeAsString(param, typeChecker);
            const isRequired = !param.questionToken;
            
            return {
              name: paramName,
              type: paramType,
              isRequired
            };
          });
          
          // Extract return type
          const returnType = member.type 
            ? member.type.getText() 
            : getTypeAsString(member, typeChecker);
          
          methods.push({
            name: methodName,
            params,
            returnType
          });
        }
      }
    });
    
    // Check if it's a React component class
    const implementsClauses = node.heritageClauses?.filter(
      clause => clause.token === ts.SyntaxKind.ImplementsKeyword
    );
    
    const extendsReactComponent = node.heritageClauses?.some(
      clause => 
        clause.token === ts.SyntaxKind.ExtendsKeyword &&
        clause.types.some(
          type => 
            type.expression.getText().includes('React.Component') ||
            type.expression.getText().includes('Component')
        )
    );
    
    if (extendsReactComponent) {
      // React component class
      const componentInfo: ComponentInfo = {
        name: className,
        type: 'class',
        isExported,
        isClientComponent: checkUseClientDirective(sourceFile),
        isServerComponent: !checkUseClientDirective(sourceFile),
        props: [],
        hooks: {
          useState: [],
          useEffect: false,
          useCallback: false,
          useMemo: false,
          useRef: false,
          customHooks: []
        },
        usedComponents: [],
        usedInFiles: []
      };
      
      // Extract JSX usage and component references from render method
      const renderMethod = methods.find(m => m.name === 'render');
      if (renderMethod) {
        const renderNode = node.members.find(
          m => ts.isMethodDeclaration(m) && 
          ts.isIdentifier(m.name) && 
          m.name.text === 'render'
        );
        
        if (renderNode && ts.isMethodDeclaration(renderNode) && renderNode.body) {
          analyzeNodeForComponentUsage(renderNode.body, componentInfo);
        }
      }
      
      fileInfo.exports.components.push(componentInfo);
    } else {
      // Regular class
      const classInfo: ClassInfo = {
        name: className,
        isExported,
        methods,
        properties,
        usedInFiles: []
      };
      
      fileInfo.exports.classes.push(classInfo);
    }
  }

  // Analyze node for hooks usage
  function analyzeNodeForHooksAndComponents(
    node: ts.Node,
    componentInfo: ComponentInfo
  ): void {
    // Check for React Hooks
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression)) {
        const hookName = expression.text;
        if (hookName === 'useState') {
          analyzeUseState(node, componentInfo);
        } else if (hookName === 'useEffect') {
          componentInfo.hooks.useEffect = true;
        } else if (hookName === 'useCallback') {
          componentInfo.hooks.useCallback = true;
        } else if (hookName === 'useMemo') {
          componentInfo.hooks.useMemo = true;
        } else if (hookName === 'useRef') {
          componentInfo.hooks.useRef = true;
        } else if (hookName.startsWith('use')) {
          componentInfo.hooks.customHooks.push(hookName);
        }
      }
    }
    
    // Check for JSX elements and components usage
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = ts.isJsxElement(node)
        ? node.openingElement.tagName.getText()
        : node.tagName.getText();
      
      // Skip HTML elements (lowercase tags)
      if (tagName[0] === tagName[0].toUpperCase()) {
        // This is likely a component
        componentInfo.usedComponents.push(tagName);
      }
    }
    
    // Continue traversing
    ts.forEachChild(node, child => analyzeNodeForHooksAndComponents(child, componentInfo));
  }

  // Analyze component usage in class components
  function analyzeNodeForComponentUsage(
    node: ts.Node,
    componentInfo: ComponentInfo
  ): void {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = ts.isJsxElement(node)
        ? node.openingElement.tagName.getText()
        : node.tagName.getText();
      
      // Skip HTML elements (lowercase tags)
      if (tagName[0] === tagName[0].toUpperCase()) {
        // This is likely a component
        componentInfo.usedComponents.push(tagName);
      }
    }
    
    // Continue traversing
    ts.forEachChild(node, child => analyzeNodeForComponentUsage(child, componentInfo));
  }

  // Analyze useState hook
  function analyzeUseState(
    node: ts.CallExpression,
    componentInfo: ComponentInfo
  ): void {
    if (node.parent && ts.isVariableDeclaration(node.parent)) {
      const declaration = node.parent;
      
      if (ts.isArrayBindingPattern(declaration.name)) {
        const elements = declaration.name.elements;
        if (elements.length >= 2) {
          const stateName = elements[0].getText();
          const setState = elements[1].getText();
          
          let stateType = 'unknown';
          try {
            const typeNode = typeChecker.getTypeAtLocation(node);
            stateType = typeChecker.typeToString(typeNode);
          } catch (error) {
            console.log(`Error getting type for useState: ${error}`);
          }
          
          let initialValue = 'undefined';
          if (node.arguments.length > 0) {
            initialValue = node.arguments[0].getText();
          }
          
          componentInfo.hooks.useState.push({
            name: stateName,
            type: stateType,
            initialValue
          });
        }
      }
    }
  }

  // Main analysis function
  function analyzeNodeExports(node: ts.Node): void {
    // Import declarations
    if (ts.isImportDeclaration(node)) {
      analyzeImports(node);
    }
    
    // Function declarations
    if (ts.isFunctionDeclaration(node)) {
      analyzeFunctionDeclaration(node);
    }
    
    // Variable declarations (including arrow function components)
    if (ts.isVariableStatement(node)) {
      analyzeVariableDeclaration(node);
    }
    
    // Interface declarations
    if (ts.isInterfaceDeclaration(node)) {
      analyzeInterfaceDeclaration(node);
    }
    
    // Type declarations
    if (ts.isTypeAliasDeclaration(node)) {
      analyzeTypeDeclaration(node);
    }
    
    // Class declarations
    if (ts.isClassDeclaration(node)) {
      analyzeClassDeclaration(node);
    }
    
    // Export declarations
    if (ts.isExportDeclaration(node)) {
      // Handle export { X, Y } from './path'
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        node.exportClause.elements.forEach(element => {
          // Mark the exported item as exported if found
          const exportName = element.name.text;
          const originalName = element.propertyName?.text || exportName;
          
          // Mark as exported in our data structures
          markAsExported(originalName);
        });
      }
    }
    
    // Continue traversing
    ts.forEachChild(node, analyzeNodeExports);
  }

  // Mark an element as exported by name
  function markAsExported(name: string): void {
    // Check components
    fileInfo.exports.components.forEach(comp => {
      if (comp.name === name) {
        comp.isExported = true;
      }
    });
    
    // Check functions
    fileInfo.exports.functions.forEach(func => {
      if (func.name === name) {
        func.isExported = true;
      }
    });
    
    // Check interfaces
    fileInfo.exports.interfaces.forEach(int => {
      if (int.name === name) {
        int.isExported = true;
      }
    });
    
    // Check types
    fileInfo.exports.types.forEach(type => {
      if (type.name === name) {
        type.isExported = true;
      }
    });
    
    // Check classes
    fileInfo.exports.classes.forEach(cls => {
      if (cls.name === name) {
        cls.isExported = true;
      }
    });
    
    // Check variables
    fileInfo.exports.variables.forEach(vr => {
      if (vr.name === name) {
        vr.isExported = true;
      }
    });
  }

  // Start the analysis
  try {
    analyzeNodeExports(sourceFile);
  } catch (error) {
    console.error(`Error analyzing file ${sourceFile.fileName}:`, error);
  }

  return fileInfo;
}

// Function to find dependencies between files and components
function findDependencies(
  filesAnalysis: FileAnalysis[],
  sourceFiles: readonly ts.SourceFile[]
): void {
  const filePathMap = new Map<string, FileAnalysis>();
  
  // Create a map of file paths to their analysis data
  filesAnalysis.forEach(file => {
    filePathMap.set(file.filePath, file);
  });
  
  // Process outgoing dependencies and establish incoming dependencies
  filesAnalysis.forEach(file => {
    file.outgoingDependencies.forEach(depPath => {
      const dependency = filePathMap.get(depPath);
      if (dependency) {
        dependency.incomingDependencies.push(file.filePath);
      }
    });
  });
  
  // Find component usage across files
  filesAnalysis.forEach(file => {
    // Check for component usage
    file.exports.components.forEach(component => {
      if (!component.isExported) return;
      
      // Look for usage in JSX
      sourceFiles.forEach(sourceFile => {
        if (sourceFile.fileName === file.filePath) return; // Skip self
        
        let isUsed = false;
        
        // Traverse the source file looking for component usage
        function findComponentInJsx(node: ts.Node): void {
          if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
            const tagName = ts.isJsxElement(node)
              ? node.openingElement.tagName.getText()
              : node.tagName.getText();
            
            if (tagName === component.name) {
              isUsed = true;
            }
          }
          
          ts.forEachChild(node, findComponentInJsx);
        }
        
        findComponentInJsx(sourceFile);
        
        if (isUsed) {
          component.usedInFiles.push(sourceFile.fileName);
          
          const targetFileAnalysis = filePathMap.get(sourceFile.fileName);
          if (targetFileAnalysis) {
            targetFileAnalysis.usedByComponents.push(component.name);
          }
        }
      });
    });
    
    // Check for function usage (basic implementation - can be enhanced)
    file.exports.functions.forEach(func => {
      if (!func.isExported) return;
      
      sourceFiles.forEach(sourceFile => {
        if (sourceFile.fileName === file.filePath) return; // Skip self
        
        let isUsed = false;
        
        // Find function usage in other files
        function findFunctionUsage(node: ts.Node): void {
          if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
            if (node.expression.text === func.name) {
              isUsed = true;
            }
          }
          
          ts.forEachChild(node, findFunctionUsage);
        }
        
        findFunctionUsage(sourceFile);
        
        if (isUsed) {
          func.usedInFiles.push(sourceFile.fileName);
        }
      });
    });
  });
}


// Main function to analyze a project
function analyzeProject(projectPath: string): void {
  console.log(`\n=== TypeScript Dependencies Analyzer ===`);
  console.log(`Starting analysis of project at path: ${projectPath}\n`);

  // Verify directory exists
  if (!fs.existsSync(projectPath)) {
    console.error(`Error: Directory ${projectPath} does not exist`);
    return;
  }

  // Get all TypeScript files recursively
  const filePaths = getAllFiles(projectPath);

  // Helper function to get all TypeScript files recursively
  function getAllFiles(dir: string, fileList: string[] = []): string[] {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
      const filePath = path.join(dir, file);
      if (fs.statSync(filePath).isDirectory()) {
        if (file !== 'node_modules') {
          getAllFiles(filePath, fileList);
        }
      } else if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
        fileList.push(filePath);
      }
    });
    return fileList;
  }
  console.log(`\nFound ${filePaths.length} TypeScript/TSX files`);

  if (filePaths.length === 0) {
    console.log('No TypeScript files found. Exiting.');
    return;
  }

  // Create a TypeScript program
  const program = ts.createProgram(filePaths, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React,
    allowJs: true,
    checkJs: true
  });

  const typeChecker = program.getTypeChecker();
  const sourceFiles = program.getSourceFiles().filter(file => !file.isDeclarationFile);

  // Analyze each file
  const filesAnalysis: FileAnalysis[] = sourceFiles.map(sourceFile =>
    analyzeFile(sourceFile, typeChecker, program, program.getCompilerOptions())
  );

  // Find dependencies between files and components
  findDependencies(filesAnalysis, sourceFiles);

  // Output the analysis results in JSON format
  console.log('\n=== Analysis Results (JSON) ===');
  fs.writeFileSync('analysis-results-codeTracker.json', JSON.stringify(filesAnalysis, null, 2));
  console.log('Analysis results written to analysis-results.json');

  console.log('\nAnalysis complete.');
}
let projectPath='/Users/adityapande/Desktop/trial-project/src';
let codeTracker='/Users/adityapande/Desktop/Project/CodeTracker'
// analyzeProject(projectPath);
analyzeProject(codeTracker);


