// The CALENDAR fake passes its own contract cases (LawDocsComply PR-LDC-53; R1-D-126).
import { defineContractSuite } from "../contract.js";
import { FakeCalendar, calendarContractCases } from "./calendar.js";

const calendar = new FakeCalendar();
defineContractSuite("CALENDAR", () => calendar, calendarContractCases(calendar));
