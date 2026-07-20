export interface CapturedApiEvent {
  /** logical name, e.g. "account-created" or "trial-booked" */
  name: string;
  url: string;
  status: number;
  /** parsed JSON body, if any */
  body: unknown;
}

export interface QuizRunResult {
  /** true as soon as the driver believes the quiz reached a terminal/success state */
  reachedSuccess: boolean;
  /** how it decided that: url match, captured API event, or ran out of steps */
  successSignal: "url" | "api" | "none";
  stepsTaken: number;
  finalUrl: string;
  capturedEvents: CapturedApiEvent[];
}
