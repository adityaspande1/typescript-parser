import { Project, SyntaxKind } from "ts-morph";
import path from "path";
import fs from "fs";

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

function getAllTsxFiles(dir: string): string[] {
  let tsxFiles: string[] = [];
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      tsxFiles = tsxFiles.concat(getAllTsxFiles(fullPath)); // Recursively search subdirectories
    } else if (file.endsWith(".tsx")) {
      tsxFiles.push(fullPath);
    }
  }

  return tsxFiles;
}

function analyzeReactComponent(filePath: string): ComponentAnalysis | null {
  const project = new Project();
  const sourceFile = project.addSourceFileAtPath(filePath);

  const componentInfo: ComponentAnalysis = {
    fileName: path.basename(filePath),
    componentName: "",
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
  };

  // Check for "use client" directive
  const firstStatement = sourceFile.getStatements()[0];
  if (
    firstStatement?.getKind() === SyntaxKind.ExpressionStatement &&
    firstStatement.getText().includes('"use client"')
  ) {
    componentInfo.isClientComponent = true;
  }

  // Find the component function or arrow function
  const functions = sourceFile.getFunctions();
  const variableDeclarations = sourceFile.getVariableDeclarations();

  functions.forEach((func) => {
    if (func.isDefaultExport() || func.isExported()) {
      componentInfo.isExported = true;
    }
    componentInfo.componentName = func.getName() || "";
  });

  variableDeclarations.forEach((variable) => {
    const initializer = variable.getInitializer();
    if (initializer && initializer.getKind() === SyntaxKind.ArrowFunction) {
      const name = variable.getName();
      componentInfo.componentName = name;
      componentInfo.isExported = variable.getVariableStatement()?.isExported() || false;
    }
  });

  // Find Props interface
  sourceFile.getInterfaces().forEach((iface) => {
    if (iface.getName().includes("Props")) {
      iface.getProperties().forEach((prop) => {
        componentInfo.props.push({
          name: prop.getName(),
          type: prop.getType().getText(),
          isRequired: !prop.hasQuestionToken(),
        });
      });
    }
  });

  // Find Props type alias
  sourceFile.getTypeAliases().forEach((typeAlias) => {
    if (typeAlias.getName().includes("Props")) {
      const typeNode = typeAlias.getTypeNode();
      if (typeNode?.getKind() === SyntaxKind.TypeLiteral) {
        typeNode.forEachChild((child) => {
          if (child.getKind() === SyntaxKind.PropertySignature) {
            const prop = child.asKind(SyntaxKind.PropertySignature)!;
            componentInfo.props.push({
              name: prop.getName(),
              type: prop.getType().getText(),
              isRequired: !prop.hasQuestionToken(),
            });
          }
        });
      }
    }
  });

  // Find useState hooks
  sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((callExpr) => {
    if (callExpr.getExpression().getText() === "useState") {
      const parent = callExpr.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      if (parent) {
        const arrayBinding = parent.getFirstChildByKind(SyntaxKind.ArrayBindingPattern);
        if (arrayBinding) {
          const stateName = arrayBinding.getElements()[0].getText();
          componentInfo.hooks.useState.push(stateName);
          componentInfo.states.push({
            name: stateName,
            type: "unknown",
            initialValue: callExpr.getArguments()[0]?.getText() || "undefined",
          });
        }
      }
    }
  });

  // Detect other hooks
  sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((callExpr) => {
    const exprText = callExpr.getExpression().getText();
    if (exprText === "useEffect") componentInfo.hooks.useEffect = true;
    if (exprText === "useCallback") componentInfo.hooks.useCallback = true;
    if (exprText === "useMemo") componentInfo.hooks.useMemo = true;
    if (exprText === "useRef") componentInfo.hooks.useRef = true;
    if (exprText.startsWith("use") && !["useState", "useEffect", "useCallback", "useMemo", "useRef"].includes(exprText)) {
      componentInfo.hooks.customHooks.push(exprText);
    }
  });

  return componentInfo.componentName ? componentInfo : null;
}

function analyzeProject(projectPath: string) {
  const tsxFiles = getAllTsxFiles(projectPath);
  const results: ComponentAnalysis[] = [];

  tsxFiles.forEach((file) => {
    const analysis = analyzeReactComponent(file);
    if (analysis) {
      results.push(analysis);
    }
  });

  const outputPath = path.join(projectPath, "morph.json");
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

  console.log(`Analysis completed. Output saved to: ${outputPath}`);
}

// Provide your project path here
const projectPath = '/Users/adityapande/Desktop/Personal/AdityaPande';
analyzeProject(projectPath);
