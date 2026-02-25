// --- Type Inferred from CVE JSON Schema:
// https://github.com/CVEProject/cve-schema/blob/main/schema/docs/CVE_Record_Format_bundled.json

/** CVE JSON Record Format (schema-aligned, v5.x) */
export interface CveRecord {
  dataType: string; // e.g. "CVE_RECORD"
  dataVersion: string; // e.g. "5.0"
  cveMetadata: CveMetadata;
  containers: Containers;

  /** Schema supports vendor/community extension properties (commonly "x_*"). */
  [k: `x_${string}`]: unknown;
}

export interface CveMetadata {
  cveId: `CVE-${number}-${string}`; // schema regex is stricter; keep usable TS template
  assignerOrgId: UUID;
  state: CveState;
  assignerShortName?: string;

  dateReserved?: Timestamp;
  datePublished?: Timestamp;
  dateUpdated?: Timestamp;

  /** Some records include these depending on workflow/state. */
  requesterUserId?: UUID;
  serial?: number;

  [k: `x_${string}`]: unknown;
}

export type CveState = "PUBLISHED" | "RESERVED" | "REJECTED";

export interface Containers {
  cna: CnaContainer;
  adp?: AdpContainer[];

  [k: `x_${string}`]: unknown;
}

/* ----------------------------- CNA container ----------------------------- */

export interface CnaContainer {
  providerMetadata: ProviderMetadata;

  // Common CNA fields
  title?: string;
  descriptions?: LangString[];
  affected?: Product[];
  references?: Reference[];
  problemTypes?: ProblemType[];
  impacts?: Impact[];
  solutions?: Solution[];
  workarounds?: Workaround[];
  configurations?: Configuration[];
  credits?: Credit[];
  timeline?: TimelineEntry[];
  metrics?: Metric[];

  dateAssigned?: Timestamp;
  datePublic?: Timestamp;
  source?: Source;

  [k: `x_${string}`]: unknown;
}

export interface ProviderMetadata {
  orgId: UUID;
  shortName?: string;
  dateUpdated: Timestamp;

  [k: `x_${string}`]: unknown;
}

/* ----------------------------- ADP container ----------------------------- */

export interface AdpContainer {
  providerMetadata: ProviderMetadata;

  title?: string;
  descriptions?: LangString[];
  references?: Reference[];
  affected?: Product[];
  metrics?: Metric[];
  timeline?: TimelineEntry[];

  [k: `x_${string}`]: unknown;
}

/* ------------------------------ Shared types ----------------------------- */

export interface LangString {
  lang: string; // usually BCP-47, schema constrains elsewhere
  value: string;

  [k: `x_${string}`]: unknown;
}

export interface Reference {
  url: URI;
  name?: string;
  tags?: ReferenceTag[];

  [k: `x_${string}`]: unknown;
}

export type ReferenceTag =
  | "broken-link"
  | "customer-entitlement"
  | "exploit"
  | "government-resource"
  | "issue-tracking"
  | "mailing-list"
  | "mitigation"
  | "not-applicable"
  | "patch"
  | "permissions-required"
  | "media-coverage"
  | "product"
  | "related"
  | "release-notes"
  | "signature"
  | "technical-description"
  | "third-party-advisory"
  | "vendor-advisory"
  | "vdb-entry"
  | `x_${string}`; // schema allows tag extensions :contentReference[oaicite:1]{index=1}

export interface Product {
  vendor?: string;
  product?: string;

  // package-style identification (alternative to vendor/product in schema)
  collectionURL?: URI;
  packageName?: string;

  // “versions” OR “defaultStatus” required by schema’s product definition :contentReference[oaicite:2]{index=2}
  versions?: Version[];
  defaultStatus?: VersionStatus;

  cpes?: CpeName[];
  modules?: Module[];
  platforms?: string[];
  programFiles?: string[];
  programRoutines?: string[];
  repo?: string;

  [k: `x_${string}`]: unknown;
}

export interface Version {
  version: string;
  status: VersionStatus;

  versionType?: string; // e.g. "semver", "custom", etc.
  lessThan?: string;
  lessThanOrEqual?: string;
  greaterThan?: string;
  greaterThanOrEqual?: string;

  [k: `x_${string}`]: unknown;
}

export type VersionStatus = "affected" | "unaffected" | "unknown";

export type CpeName = string; // schema regex for CPE 2.2/2.3 is enforced server-side :contentReference[oaicite:3]{index=3}

export interface Module {
  name: string;
  [k: `x_${string}`]: unknown;
}

export interface ProblemType {
  descriptions: Array<{
    lang: string;
    description: string;
    cweId?: string; // frequently present
    type?: string;
    [k: `x_${string}`]: unknown;
  }>;

  [k: `x_${string}`]: unknown;
}

export interface Metric {
  format: string; // e.g. "CVSS"
  scenarios?: LangString[];

  // CVSS blocks vary by version in schema; keep flexible but useful.
  cvssV3_1?: CvssV3_1;
  cvssV3_0?: CvssV3_0;
  cvssV2_0?: CvssV2_0;
  cvssV4_0?: CvssV4_0;

  other?: {
    type: string;
    content: unknown;
  };

  [k: `x_${string}`]: unknown;
}

export interface CvssV4_0 {
  // Not in the schema, but present in the data
  version: "4.0";
  vectorString: string;
  baseScore: number;
  baseSeverity: string;

  [k: `x_${string}`]: unknown;
}

export interface CvssV3_1 {
  version: "3.1";
  vectorString: string;
  baseScore: number;
  baseSeverity: string;
  attackVector?: string;
  attackComplexity?: string;
  privilegesRequired?: string;
  userInteraction?: string;
  scope?: string;
  confidentialityImpact?: string;
  integrityImpact?: string;
  availabilityImpact?: string;

  [k: `x_${string}`]: unknown;
}

export interface CvssV3_0 {
  version: "3.0";
  vectorString: string;
  baseScore: number;
  baseSeverity: string;

  [k: `x_${string}`]: unknown;
}

export interface CvssV2_0 {
  version: "2.0";
  vectorString: string;
  baseScore: number;

  [k: `x_${string}`]: unknown;
}

export interface TimelineEntry {
  time: Timestamp;
  lang?: string;
  value: string;

  [k: `x_${string}`]: unknown;
}

export interface Impact {
  descriptions?: LangString[];
  [k: `x_${string}`]: unknown;
}

export interface Solution {
  descriptions?: LangString[];
  [k: `x_${string}`]: unknown;
}

export interface Workaround {
  descriptions?: LangString[];
  [k: `x_${string}`]: unknown;
}

export interface Configuration {
  descriptions?: LangString[];
  [k: `x_${string}`]: unknown;
}

export interface Credit {
  lang?: string;
  value?: string;
  type?: string;
  [k: `x_${string}`]: unknown;
}

export interface Source {
  discovery?: string;
  defect?: string;
  [k: `x_${string}`]: unknown;
}

/* ------------------------------ Primitives ------------------------------ */

export type URI = string; // schema: format "uri", max length constraints :contentReference[oaicite:4]{index=4}
export type UUID = string; // schema: UUIDv4 regex :contentReference[oaicite:5]{index=5}
export type Timestamp = string; // schema: RFC3339-ish timestamp regex :contentReference[oaicite:6]{index=6}
