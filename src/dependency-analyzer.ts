import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

interface ComponentAnalysis {
  fileName: string;
  componentName: string;
  isClientComponent: boolean;
  isServerComponent: boolean;
  isExported: boolean;
  props: PropInterface[];
  hooks: {
    useState: string[];
    useEffect: boolean;
    useCallback: boolean;
    useMemo: boolean;
    useRef: boolean;
    customHooks: string[];
  };
  states: StateInterface[];
  usedInComponents: string[];
}

interface PropInterface {
  name: string;
  type: string;
  isRequired: boolean;
}

interface StateInterface {
  name: string;
  type: string;
  initialValue: string;
}

function analyzeReactComponent(sourceFile: ts.SourceFile, typeChecker: ts.TypeChecker): ComponentAnalysis | null {
  let componentInfo: ComponentAnalysis = {
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

  function checkUseClientDirective(node: ts.SourceFile): void {
    const firstStatement = node.statements[0];
    if (
      firstStatement &&
      ts.isExpressionStatement(firstStatement) &&
      ts.isStringLiteral(firstStatement.expression) &&
      firstStatement.expression.text === 'use client'
    ) {
      componentInfo.isClientComponent = true;
    }
  }

  function analyzeHooks(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression)) {
        const hookName = expression.text;
        if (hookName === 'useState') {
          analyzeUseState(node);
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
    ts.forEachChild(node, analyzeHooks);
  }

  function analyzeUseState(node: ts.CallExpression): void {
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

  function analyzePropsInterface(node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration): void {
    if (node.name.getText().includes('Props')) {
      let members: ts.NodeArray<ts.TypeElement> | undefined;
  
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
  

  function analyzeNode(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) || ts.isVariableStatement(node)) {
      let componentName = '';
      if (ts.isFunctionDeclaration(node) && node.name) {
        componentName = node.name.text;
      } else if (
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.length > 0
      ) {
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

  function hasExportKeyword(node: ts.Node): boolean {
    return !!(ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export);
  }

  checkUseClientDirective(sourceFile);
  analyzeNode(sourceFile);

  return componentInfo.componentName ? componentInfo : null;
}

function findComponentUsage(sourceFiles: readonly ts.SourceFile[], componentName: string): string[] {
  const usedIn: string[] = [];

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

function analyzeProject(projectPath: string): void {
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
  const components: ComponentAnalysis[] = [];

  sourceFiles.forEach((sourceFile) => {
    if (!sourceFile.isDeclarationFile && sourceFile.fileName.includes(projectPath)) {
      const componentAnalysis = analyzeReactComponent(sourceFile, typeChecker);
      if (componentAnalysis) {
        componentAnalysis.usedInComponents = findComponentUsage(
          sourceFiles,
          componentAnalysis.componentName
        );
        components.push(componentAnalysis);
      }
    }
  });

  fs.writeFileSync('component-analysis.json', JSON.stringify(components, null, 2));
}

const projectPath = '/Users/adityapande/Desktop/trial-project/src'; // Update this with the correct project path
analyzeProject(projectPath);
