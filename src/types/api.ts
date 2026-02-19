// Shared response contract types for backend handlers and frontend clients.

// Roast-age guidance status computed from roast date.
export type RestingStatus = "UNKNOWN" | "RESTING" | "READY" | "PAST_PEAK";

// One field-level validation issue.
export type ValidationIssue = {
  field: string;
  message: string;
};

// Standardized validation error payload.
export type ValidationErrorResponse = {
  errors: ValidationIssue[];
};

// Computed fields appended to bag responses.
export type BagComputedFields = {
  roastAgeDays: number | null;
  restingStatus: RestingStatus;
};

// Single bag response shape.
export type BagDetailResponse = {
  id: string;
  userId: string;
  coffeeName: string;
  roaster: string;
  origin: string | null;
  process: string | null;
  roastDate: Date | null;
  notes: string | null;
  status: "ACTIVE" | "ARCHIVED";
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
} & BagComputedFields;

// Bag list item shape with brew count aggregate.
export type BagListItemResponse = BagDetailResponse & {
  brewCount: number;
  averageRating: number | null;
};

// Single brew response shape.
export type BrewResponse = {
  id: string;
  bagId: string;
  method: string;
  brewer: string | null;
  grinder: string | null;
  dose: number | null;
  grindSetting: number | null;
  waterAmount: number | null;
  rating: number | null;
  nutty: number | null;
  acidity: number | null;
  fruity: number | null;
  floral: number | null;
  sweetness: number | null;
  chocolate: number | null;
  isBest: boolean;
  flavourNotes: string | null;
  createdAt: Date;
};

// Analytics endpoint response shape.
export type AnalyticsResponse = {
  bagId: string;
  roastAgeDays: number | null;
  restingStatus: RestingStatus;
  totalBrews: number;
  averageRating: number | null;
  averageTasteProfile: {
    nutty: number | null;
    acidity: number | null;
    fruity: number | null;
    floral: number | null;
    sweetness: number | null;
    chocolate: number | null;
  };
  brewMethods: Array<{
    method: string;
    count: number;
  }>;
  ratingTrend: Array<{
    brewNumber: number;
    rating: number;
    createdAt: Date;
  }>;
  bestBrew: BrewResponse | null;
};

// Global social feed row shape with basic bag + brew context.
export type GlobalFeedItemResponse = {
  brewId: string;
  bagId: string;
  userId: string;
  coffeeName: string;
  roaster: string;
  method: string;
  brewer: string | null;
  grinder: string | null;
  dose: number | null;
  grindSetting: number | null;
  waterAmount: number | null;
  rating: number | null;
  flavourNotes: string | null;
  isBest: boolean;
  createdAt: Date;
};
