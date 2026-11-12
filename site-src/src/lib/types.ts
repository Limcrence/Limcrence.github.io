export type Evidence = { paragraph: string; text: string };
export type Annotation = { anchors: string[]; paraphrases: string; explanation: string; evidence: Evidence[]; location: string };
export type Question = {
  id: string; exercise_id: string; source_type: string; source_name: string;
  assignment_group: string; passage_code: string; article_id: string;
  passage_title: string; date: string; question_number: string;
  original_number: string; question_type: string; raw_type: string;
  instructions: string; question: string; full_context: string;
  options: Record<string, string>; student_answer_raw: string[];
  correct_answer_raw: string[]; student_answer: string; correct_answer: string;
  status: string; points: number; score: number; report_url: string;
  image_urls: string[]; group_id: number; review_id?: string; review?: Annotation;
};
export type Exercise = {
  id: string; source_type: string; source_name: string; assignment_group: string;
  passage_code: string; title: string; article_id: string; date: string;
  website_score: number; website_total: number; wrong_rows: number; unanswered_rows: number;
};
export type Article = { id: string; title: string; paragraphs: {label: string; text: string}[] };
export type Library = { checked_at: string; exercises: Exercise[]; articles: Article[]; questions: Question[] };
export type Result = "correct" | "wrong" | "partial" | "revealed" | "";
export type Origin = "unknown" | "serious" | "rushed";
export type ReviewRecord = {
  questionId: string; state: "learning" | "mastered"; note: string;
  draft: string[]; lastAnswer: string[]; lastResult: Result; attempts: number; updatedAt: number; origin: Origin;
};
export type Progress = Record<string, ReviewRecord>;
export type SaveOperation = {questionId: string; op: "draft" | "note" | "state" | "attempt" | "origin"; value: unknown};
