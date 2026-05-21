import fs from "node:fs";
import path from "node:path";
import artifactTemplateRegistry from "../../../schemas/artifact-template-registry.json" with { type: "json" };

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");

export function getArtifactTemplateRegistry() {
  return artifactTemplateRegistry;
}

export function findArtifactTemplateByType(artifactType) {
  return artifactTemplateRegistry.templates.find((template) => template.artifactType === artifactType) || null;
}

export function findArtifactTemplateByKey(templateKey) {
  return artifactTemplateRegistry.templates.find((template) => template.templateKey === templateKey) || null;
}

export function loadArtifactTemplateByKey(templateKey) {
  const template = findArtifactTemplateByKey(templateKey);
  if (!template) {
    return null;
  }

  const absolutePath = path.join(workspaceRoot, template.path);
  return {
    ...template,
    contentMarkdown: fs.readFileSync(absolutePath, "utf8"),
  };
}

export function loadArtifactTemplateByType(artifactType) {
  const template = findArtifactTemplateByType(artifactType);
  return template ? loadArtifactTemplateByKey(template.templateKey) : null;
}

