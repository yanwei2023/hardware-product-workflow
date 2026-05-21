function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractMarkdownHeadings(markdown) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.match(/^#{1,6}\s+(.+?)\s*$/)?.[1]?.trim())
    .filter(Boolean);
}

export function validateArtifactMarkdown(markdown, artifactTemplate) {
  const headings = extractMarkdownHeadings(markdown);
  const missingSections = [];
  const emptySections = [];

  for (const requiredSection of artifactTemplate.requiredSections || []) {
    const sectionExists =
      headings.some(
        (heading) => heading === requiredSection || heading.endsWith(requiredSection) || heading.includes(requiredSection),
      ) || markdown.includes(requiredSection);

    if (!sectionExists) {
      missingSections.push(requiredSection);
      continue;
    }

    const sectionPattern = new RegExp(
      `^#{1,6}\\s+.*${escapeRegExp(requiredSection)}\\s*$([\\s\\S]*?)(?=^#{1,6}\\s+|\\z)`,
      "m",
    );
    const match = markdown.match(sectionPattern);
    const body = match?.[1]?.trim() || "";
    const hasOnlyPlaceholders =
      body === "" ||
      body
        .replace(/\|/g, "")
        .replace(/-/g, "")
        .replace(/是\/否|高\/中\/低|批准 \/ 驳回 \/ 有条件批准/g, "")
        .replace(/\s/g, "") === "";

    if (hasOnlyPlaceholders) {
      emptySections.push(requiredSection);
    }
  }

  return {
    status: missingSections.length === 0 ? "PASSED" : "FAILED",
    missingSections,
    emptySections,
    headings,
  };
}
