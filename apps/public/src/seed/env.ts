// The group's identity for the public-site seed (PL5 plan §9.3, owner rules O-4 and O-6). Every value
// defaults to a reserved, clearly fictional one (an `example.org` mailbox, a placeholder CIN), so a
// dev or test site never shows a real entity by accident. The seed never runs in prod, dr or
// pre-prod; there the real values are entered once in Studio under maker-checker.
import { z } from "zod";
import { envUrl, envVar } from "@infrabyx/config/env";

const v = (desc: string, example: string) =>
  envVar(z.string().min(1).default(example), {
    desc,
    example,
    required: "opt",
    sens: "C",
    port: "SEED",
  });
const office = (city: string, example: string) =>
  envVar(
    z
      .string()
      .regex(/^[^|]+(\|[^|]+){0,3}\|[1-9][0-9]{5}$/, "lines|…|PIN")
      .default(example),
    {
      desc: `${city} office: up to four address lines and the PIN, separated by |`,
      example,
      required: "opt",
      sens: "C",
      port: "SEED",
    },
  );

export const groupSeedEnvSchema = z.object({
  SEED_GROUP_ENTITY_NAME: v("Legal entity name of the group", "Example Group Private Limited"),
  SEED_GROUP_CIN: v(
    "CIN of the group entity (placeholder in dev and test)",
    "U00000DL2026PTC000000",
  ),
  SEED_GROUP_GSTIN: v("GSTIN of the group entity (placeholder in dev and test)", "07AAAAA0000A0Z0"),
  SEED_GROUP_REGISTERED_OFFICE: v(
    "Registered office, one line",
    "1 Example Road, New Delhi 110001, India",
  ),
  SEED_GROUP_GRIEVANCE_NAME: v("Grievance Officer's name", "Example Officer"),
  SEED_GROUP_GRIEVANCE_EMAIL: v("Grievance Officer's email", "grievance@example.org"),
  SEED_GROUP_DPO_NAME: v("Data Protection Officer's name", "Example Officer"),
  SEED_GROUP_DPO_EMAIL: v("Data Protection Officer's email", "dpo@example.org"),
  SEED_GROUP_PHONE: v("Contact phone", "+91 11 0000 0000"),
  SEED_GROUP_EMAIL: v("Contact email", "hello@example.org"),
  SEED_GROUP_STATUS_URL: envVar(envUrl().default("https://status.example.org"), {
    desc: "Status page URL (https)",
    example: "https://status.example.org",
    required: "opt",
    sens: "C",
    port: "SEED",
  }),
  SEED_GROUP_SOCIAL_URL: envVar(envUrl().default("https://social.example.org/infrabyx"), {
    desc: "The group's social profile URL (https)",
    example: "https://social.example.org/infrabyx",
    required: "opt",
    sens: "C",
    port: "SEED",
  }),
  SEED_GROUP_OFFICE_DELHI: office("Delhi", "1 Example Road|New Delhi|110001"),
  SEED_GROUP_OFFICE_NOIDA: office("Noida", "2 Example Avenue|Sector 1, Noida|201301"),
  SEED_GROUP_OFFICE_JAIPUR: office("Jaipur", "3 Example Marg|Jaipur|302001"),
  SEED_GROUP_HOSTS: envVar(
    z
      .string()
      .regex(/^[a-z0-9.-]+(,[a-z0-9.-]+)*$/)
      .default("group.example.org"),
    {
      desc: "Comma-separated hosts the group pack serves (the first is primary)",
      example: "group.example.org",
      required: "opt",
      sens: "C",
      port: "SEED",
    },
  ),
});
export type GroupSeedEnv = z.output<typeof groupSeedEnvSchema>;
