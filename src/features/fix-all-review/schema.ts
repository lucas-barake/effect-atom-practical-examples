import * as Schema from "effect/Schema";

export class ReviewViolation extends Schema.Class<ReviewViolation>("ReviewViolation")({
  code: Schema.Literal("owner", "dueDate", "specificity"),
  message: Schema.String,
}) {}

export class ReviewEvaluation extends Schema.Class<ReviewEvaluation>("ReviewEvaluation")({
  passed: Schema.Boolean,
  violations: Schema.Array(ReviewViolation),
}) {}

export class ReviewItem extends Schema.Class<ReviewItem>("ReviewItem")({
  id: Schema.String,
  title: Schema.String,
  owner: Schema.String,
  dueDate: Schema.String,
  content: Schema.String,
  evaluation: Schema.NullOr(ReviewEvaluation),
}) {}
