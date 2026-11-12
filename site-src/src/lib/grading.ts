import type { Question, Result } from "./types";
export function normalizeAnswer(value: string) {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ").replace(/[‘’]/g, "'").replace(/[‐‑–]/g, "-");
}
export function gradeAnswer(q: Pick<Question, "options" | "correct_answer_raw" | "points">, answer: string[]): {result: Result; earned: number; total: number} {
  if (Object.keys(q.options).length > 0) {
    const expected = new Set(q.correct_answer_raw.map(normalizeAnswer));
    const actual = new Set(answer.filter(Boolean).map(normalizeAnswer));
    const earned = [...actual].filter(a => expected.has(a)).length;
    const exact = actual.size === expected.size && earned === expected.size;
    return {result: exact ? "correct" : earned > 0 && q.points > 1 ? "partial" : "wrong", earned: exact ? q.points : q.points > 1 ? Math.min(earned, q.points) : 0, total:q.points};
  }
  const actual = normalizeAnswer(answer[0] || "");
  const accepted=q.correct_answer_raw.flatMap(value=>[value,...value.split(/\s*[/／]\s*/)]).map(normalizeAnswer);
  const exact = !!actual && accepted.includes(actual);
  return {result:exact ? "correct" : "wrong", earned:exact ? q.points : 0, total:q.points};
}
export function shortSource(item: {source_type: string; source_name: string; assignment_group: string}) {
  return item.source_type === "周测" ? item.source_name.replace("雅思阅读", "").replace(/\s+/g, " ").trim()
    : item.source_type === "专项练习" ? "教材 · " + item.assignment_group.replace("Summary 填空和选词填空题", "Summary").replace("细节段落匹配题", "段落匹配") : "考场真题汇总";
}
export function displayNumber(q: {original_number: string; question_number: string}) { return q.original_number || q.question_number; }
export function originalAnswer(q: Pick<Question, "student_answer" | "student_answer_raw">) {
  const raw=q.student_answer_raw[0];
  return raw && raw.trim()!==raw ? raw.replace(/^ +| +$/g,s=>"␠".repeat(s.length))+"（含首尾空格）" : q.student_answer;
}
