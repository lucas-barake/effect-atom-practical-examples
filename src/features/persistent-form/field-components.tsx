import type * as FormReact from "@lucas-barake/effect-form-react/FormReact";
import * as Option from "effect/Option";
import { type BriefDraft } from "./schema";

const TextField = ({
  label,
  field,
}: {
  readonly label: string;
  readonly field: {
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly onBlur: () => void;
    readonly error: Option.Option<string>;
  };
}) => (
  <label className="FormField">
    <span className="FieldLabel">{label}</span>
    <input
      className="TextInput"
      onBlur={field.onBlur}
      onChange={(event) => field.onChange(event.target.value)}
      value={field.value}
    />
    {Option.isSome(field.error) && <span className="FieldError">{field.error.value}</span>}
  </label>
);

export const TitleField: FormReact.FieldComponent<string> = ({ field }) => (
  <TextField field={field} label="Title" />
);

export const AudienceField: FormReact.FieldComponent<string> = ({ field }) => (
  <TextField field={field} label="Audience" />
);

export const GoalField: FormReact.FieldComponent<string> = ({ field }) => (
  <TextField field={field} label="Goal" />
);

export const ToneField: FormReact.FieldComponent<BriefDraft["tone"]> = ({ field }) => (
  <label className="FormField">
    <span className="FieldLabel">Tone</span>
    <select
      className="SelectInput"
      onBlur={field.onBlur}
      onChange={(event) => field.onChange(event.target.value as BriefDraft["tone"])}
      value={field.value}
    >
      <option value="confident">Confident</option>
      <option value="warm">Warm</option>
      <option value="direct">Direct</option>
    </select>
    {Option.isSome(field.error) && <span className="FieldError">{field.error.value}</span>}
  </label>
);

export const PromptField: FormReact.FieldComponent<string> = ({ field }) => (
  <label className="FormField">
    <span className="FieldLabel">Prompt</span>
    <textarea
      className="TextArea"
      onBlur={field.onBlur}
      onChange={(event) => field.onChange(event.target.value)}
      rows={8}
      value={field.value}
    />
    {Option.isSome(field.error) && <span className="FieldError">{field.error.value}</span>}
  </label>
);
