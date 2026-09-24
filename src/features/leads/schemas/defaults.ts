import type { LeadFormValues } from "./index";

/** A blank lead form. Lives beside the schema so client components can import it. */
export const EMPTY_LEAD_VALUES: LeadFormValues = {
  title: "",
  contactName: "",
  company: "",
  email: "",
  phone: "",
  value: "",
  probability: "",
  source: "",
  expectedCloseDate: "",
  ownerId: "",
  customerId: "",
};
