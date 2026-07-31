/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aiReads from "../aiReads.js";
import type * as aiReports from "../aiReports.js";
import type * as aiSessions from "../aiSessions.js";
import type * as aiWrites from "../aiWrites.js";
import type * as analytics from "../analytics.js";
import type * as attachments from "../attachments.js";
import type * as audit from "../audit.js";
import type * as bases from "../bases.js";
import type * as billing from "../billing.js";
import type * as crons from "../crons.js";
import type * as demoSeed from "../demoSeed.js";
import type * as fields from "../fields.js";
import type * as forms from "../forms.js";
import type * as http from "../http.js";
import type * as lib_aggregates from "../lib/aggregates.js";
import type * as lib_analyticsTimeZone from "../lib/analyticsTimeZone.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_cells from "../lib/cells.js";
import type * as lib_data from "../lib/data.js";
import type * as lib_demoSeedData from "../lib/demoSeedData.js";
import type * as lib_fieldConversionLocks from "../lib/fieldConversionLocks.js";
import type * as lib_formSlugs from "../lib/formSlugs.js";
import type * as lib_formStats from "../lib/formStats.js";
import type * as lib_quotas from "../lib/quotas.js";
import type * as lib_rateLimits from "../lib/rateLimits.js";
import type * as lib_turnstileValidation from "../lib/turnstileValidation.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lib_viewChanges from "../lib/viewChanges.js";
import type * as lib_viewData from "../lib/viewData.js";
import type * as lib_viewIndex from "../lib/viewIndex.js";
import type * as migrations from "../migrations.js";
import type * as presence from "../presence.js";
import type * as publicActions from "../publicActions.js";
import type * as records from "../records.js";
import type * as resourcePreferences from "../resourcePreferences.js";
import type * as search from "../search.js";
import type * as tables from "../tables.js";
import type * as viewMaterializations from "../viewMaterializations.js";
import type * as views from "../views.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aiReads: typeof aiReads;
  aiReports: typeof aiReports;
  aiSessions: typeof aiSessions;
  aiWrites: typeof aiWrites;
  analytics: typeof analytics;
  attachments: typeof attachments;
  audit: typeof audit;
  bases: typeof bases;
  billing: typeof billing;
  crons: typeof crons;
  demoSeed: typeof demoSeed;
  fields: typeof fields;
  forms: typeof forms;
  http: typeof http;
  "lib/aggregates": typeof lib_aggregates;
  "lib/analyticsTimeZone": typeof lib_analyticsTimeZone;
  "lib/audit": typeof lib_audit;
  "lib/auth": typeof lib_auth;
  "lib/cells": typeof lib_cells;
  "lib/data": typeof lib_data;
  "lib/demoSeedData": typeof lib_demoSeedData;
  "lib/fieldConversionLocks": typeof lib_fieldConversionLocks;
  "lib/formSlugs": typeof lib_formSlugs;
  "lib/formStats": typeof lib_formStats;
  "lib/quotas": typeof lib_quotas;
  "lib/rateLimits": typeof lib_rateLimits;
  "lib/turnstileValidation": typeof lib_turnstileValidation;
  "lib/validators": typeof lib_validators;
  "lib/viewChanges": typeof lib_viewChanges;
  "lib/viewData": typeof lib_viewData;
  "lib/viewIndex": typeof lib_viewIndex;
  migrations: typeof migrations;
  presence: typeof presence;
  publicActions: typeof publicActions;
  records: typeof records;
  resourcePreferences: typeof resourcePreferences;
  search: typeof search;
  tables: typeof tables;
  viewMaterializations: typeof viewMaterializations;
  views: typeof views;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  baseCount: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"baseCount">;
  tableCount: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"tableCount">;
  fieldCount: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"fieldCount">;
  recordCount: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"recordCount">;
  tableRecordCount: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"tableRecordCount">;
  formCount: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"formCount">;
  submissionCount: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"submissionCount">;
  attachmentBytes: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"attachmentBytes">;
  aiTurnCount: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"aiTurnCount">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
