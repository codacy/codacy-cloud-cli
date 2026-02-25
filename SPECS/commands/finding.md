# `finding` Command Spec

**Status:** ✅ Done (2026-02-24); CVE enrichment ✅ Done (2026-02-24)

## Purpose

Show full details of a single security finding.

## Usage

```
codacy finding <provider> <organization> <findingId>
codacy fin gh my-org abc123-uuid
codacy fin gh my-org abc123-uuid --output json
```

The `findingId` is the UUID shown in dim gray at the end of each findings card.

## API Endpoints

1. [`getSecurityItem`](https://api.codacy.com/api/api-docs#getsecurityitem) — `SecurityService.getSecurityItem(provider, org, findingId)`
2. For Codacy-source findings (`itemSource === 'Codacy'`), after step 1:
   - `AnalysisService.getIssue(provider, org, item.repository, parseInt(item.itemSourceId))` → linked quality issue
   - Then in parallel: `ToolsService.getPattern(toolUuid, patternId)` + `FileService.getFileContent(...)`
   - Failures at steps 2/3 are silently caught — the finding is still shown

## Output Format

```
────────────────────────────────────────

{Priority colored} | {SecurityCategory} {ScanType} | {Optional: Likelihood} {EffortToFix} | {Optional: Repository}  {id dimmed}
{Finding title}

{Status} {DueAt} | {Optional: CVE/CWE} | {Optional: AffectedVersion → FixedVersion} | {Optional: Application} | {Optional: AffectedTargets}

{Optional: Ignored by {name} on {date}}
{Optional: Ignored reason}

{Optional: summary}
{Optional: additionalInfo}

{Optional: Remediation:}
{Optional: remediation}

{For Codacy-source: shared printIssueCodeContext output — file context + pattern docs}

────────────────────────────────────────
```

## CVE Enrichment (Pending)

When `item.cve` is present, fetch CVE data from `https://cveawg.mitre.org/api/cve/{CVE-CODE}` and add it to the output.

Use types from `src/utils/cve.ts` to parse the response. Show the enriched CVE information (description, CVSS score, references) after the finding's metadata block.

The output should match the component we have in our UI. Here's the React component code:

```
const CVSS_COLOR_MAP: Record<string, PillLabelStatus> = {
  low: 'success',
  medium: 'warning',
  high: 'high',
  critical: 'critical',
  default: 'default',
}

const CVEMetric: React.FC<{ score?: number; severity?: string }> = ({ score, severity }) => (
  <PillLabel size="md" ml={2} status={CVSS_COLOR_MAP[severity?.toLowerCase() || 'default']}>
    {score || '-'} | {capitalize(severity || '-')}
  </PillLabel>
)

export const CVEContent: React.FCC<CVEContentProps> = ({ cve, ...props }) => {
  const { data: cveData, isLoading, isError } = useCVE(cve)

  return (
    <Box backgroundColor="background-primary" p={5} borderRadius={1} {...props}>
      {isLoading && <CVEContentSkeleton />}
      {!isLoading && isError && (
        <EmptyState template="noMatch" py={6} maxWidth="50%">
          <Subheader size="lg">Sadly, we couldn't show CVE details for {cve}</Subheader>
          <Paragraph mt={4} size="md">
            The CVE data is not available or the CVE code is invalid. You can{' '}
            <Link href={`https://www.cve.org/CVERecord?id=${cve}`} isExternal size="md">
              go to the CVE website
            </Link>{' '}
            to see the details.
          </Paragraph>
        </EmptyState>
      )}
      {!isLoading && !isError && cveData && (
        <Box>
          <Flex flexDirection="row" alignItems="center" justifyContent="space-between" mb={2}>
            <Subheader size="sm" mr={2} flexGrow={1}>
              <Link href={`https://www.cve.org/CVERecord?id=${cveData.cveMetadata.cveId}`} isExternal size="lg">
                {cveData.cveMetadata.cveId}
              </Link>
            </Subheader>
            {!!cveData.containers.cna.metrics?.length && (
              <Caption size="sm" color="tertiary" mr={1}>
                <span title="Common Vulnerability Scoring System">CVSS:</span>
              </Caption>
            )}
            {cveData.containers.cna.metrics?.map((metric) => (
              <CVEMetric
                key={metric.format}
                score={
                  metric.cvssV4_0?.baseScore ||
                  metric.cvssV3_1?.baseScore ||
                  metric.cvssV3_0?.baseScore ||
                  metric.cvssV2_0?.baseScore
                }
                severity={
                  metric.cvssV4_0?.baseSeverity || metric.cvssV3_1?.baseSeverity || metric.cvssV3_0?.baseSeverity
                }
              />
            ))}
          </Flex>

          <Caption size="sm" color="tertiary" mb={4}>
            {!!cveData.cveMetadata.datePublished && (
              <>
                Published: <TimeCaption value={cveData.cveMetadata.datePublished} mr={2} />
              </>
            )}
            {!!cveData.cveMetadata.dateUpdated && (
              <>
                Updated: <TimeCaption value={cveData.cveMetadata.dateUpdated} mr={2} />
              </>
            )}
          </Caption>

          {(cveData.containers.cna.title || cveData.containers.cna.problemTypes?.length) && (
            <Subheader size="sm" mb={2}>
              {cveData.containers.cna.title ||
                cveData.containers.cna.problemTypes?.[0]?.descriptions?.filter(
                  (description) => description.lang === 'en'
                )[0]?.description}
            </Subheader>
          )}
          <Paragraph size="md" mb={6}>
            {cveData.containers.cna.descriptions?.filter((description) => description.lang === 'en')[0]?.value}
          </Paragraph>
          <Subheader size="xs" mb={2}>
            References
          </Subheader>
          <BulletedList>
            {uniqBy(
              [
                ...(cveData.containers.cna.references || []),
                ...(cveData.containers.adp?.flatMap((adp) => adp.references || []) || []),
              ],
              'url'
            ).map((reference) => (
              <li key={reference.url}>
                <Link href={reference.url} isExternal size="sm" styleType="light">
                  {reference.url}
                </Link>
              </li>
            ))}
          </BulletedList>
        </Box>
      )}
    </Box>
  )
}
```

## Tests

File: `src/commands/finding.test.ts` — 9 tests.
