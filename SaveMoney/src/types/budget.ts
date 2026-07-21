export type CategoryType = "income" | "expense";

export interface Category {
  id: number;
  name: string;
  type: CategoryType;
  color?: string | null;
}

export interface Income {
  id: number;
  date: string;
  month: string;
  label: string;
  amount: number;
  category_id: number | null;
}

export interface RecurringExpense {
  id: number;
  label: string;
  amount: number;
  category_id: number | null;
  day_of_month: number | null;
  active: number;
}

export interface Expense {
  id: number;
  date: string;
  month: string;
  label: string;
  amount: number;
  category_id: number | null;
}
