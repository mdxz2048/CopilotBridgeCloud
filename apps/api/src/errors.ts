export class ApiError extends Error {
  constructor(public status: number, public code: string, message = code, public details?: Record<string, unknown>) { super(message); }
}
