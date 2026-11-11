/**
 * The start of the request-changes note when the reviewer raises one of the
 * agent's open questions: the question, quoted, then room for the answer.
 */
export function raiseQuestionNote(question: string): string {
  const quoted = question
    .trim()
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  return `${quoted}\n\n`;
}
