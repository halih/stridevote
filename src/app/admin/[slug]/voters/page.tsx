import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ClearVoterFiltersButton } from "@/components/admin/ClearVoterFiltersButton";
import { SavedFilterControls } from "@/components/admin/SavedFilterControls";
import { Icon } from "@/components/Icon";
import { electionTypeLabel } from "@/lib/elections";
import { getSessionUser } from "@/lib/session";
import {
  filtersToSearchParams,
  getCampaignVoterDirectory,
  sanitizeVoterFilters,
  type VoterFilters,
} from "@/lib/voter-data";

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function formatElection(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function CampaignVotersPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const raw = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const filters: VoterFilters = {
    query: one(raw.query),
    precinct: one(raw.precinct),
    gender: one(raw.gender),
    minAge: one(raw.minAge),
    maxAge: one(raw.maxAge),
    election: one(raw.election),
    likelyPrimary: one(raw.likelyPrimary),
    likelyGeneral: one(raw.likelyGeneral),
    newVoter: one(raw.newVoter),
    noApartments: one(raw.noApartments),
    programId: one(raw.programId),
    canvassed: one(raw.canvassed),
    excludeCanvassed: one(raw.excludeCanvassed),
    excludeInaccessible: one(raw.excludeInaccessible),
    page: one(raw.page),
  };
  const directory = await getCampaignVoterDirectory(slug, user, filters);
  if (!directory) notFound();
  const persistableFilters = sanitizeVoterFilters(filters);
  const formKey = filtersToSearchParams(persistableFilters).toString() || "all";

  function pageHref(page: number): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value && key !== "page") query.set(key, value);
    }
    query.set("page", String(page));
    return `/admin/${slug}/voters?${query}`;
  }

  const totalPages = Math.max(1, Math.ceil(directory.total / directory.pageSize));
  const firstRow = (directory.page - 1) * directory.pageSize + 1;
  const lastRow = firstRow + directory.voters.length - 1;

  return (
    <>
      <AdminPageHeader
        title={`${directory.campaign.name} voters`}
        subtitle={directory.campaign.district}
      />
      <div className="admin-content">
            <form key={formKey} className="card voter-filters" method="get">
              <div className="voter-filter-row">
              <div className="form-field voter-search">
                <label className="field-label">Search</label>
                <input
                  className="field"
                  name="query"
                  defaultValue={filters.query}
                  placeholder="Name, voter ID, or address"
                />
              </div>
              <div className="form-field">
                <label className="field-label">Precinct</label>
                <select className="field" name="precinct" defaultValue={filters.precinct}>
                  <option value="">All precincts</option>
                  {directory.precincts.map((precinct) => (
                    <option key={precinct.value} value={precinct.value}>
                      {precinct.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label className="field-label">Gender</label>
                <select className="field" name="gender" defaultValue={filters.gender}>
                  <option value="">All</option>
                  {directory.genders.map((gender) => (
                    <option key={gender} value={gender}>{gender}</option>
                  ))}
                </select>
              </div>
              <div className="form-field voter-election">
                <label className="field-label">Voted in</label>
                <select className="field" name="election" defaultValue={filters.election}>
                  <option value="">Any election</option>
                  {directory.elections.map((election) => (
                    <option key={election.date} value={election.date}>
                      {formatElection(election.date)} · {electionTypeLabel(election.type)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field voter-age">
                <label className="field-label">Min age</label>
                <input className="field" type="number" min={18} name="minAge" defaultValue={filters.minAge} />
              </div>
              <div className="form-field voter-age">
                <label className="field-label">Max age</label>
                <input className="field" type="number" min={18} name="maxAge" defaultValue={filters.maxAge} />
              </div>
              </div>
              <div className="voter-filter-row voter-filter-row-audience">
              <div className="voter-filter-groups">
              <fieldset className="voter-audience-filters">
                <legend className="field-label">
                  Include any of
                </legend>
                <label>
                  <input
                    type="checkbox"
                    name="likelyPrimary"
                    value="1"
                    defaultChecked={filters.likelyPrimary === "1"}
                  />
                  <span
                    className="with-tooltip"
                    tabIndex={0}
                    data-tip="More than 66% of complete primaries since they registered"
                  >
                    Likely primary
                  </span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    name="likelyGeneral"
                    value="1"
                    defaultChecked={filters.likelyGeneral === "1"}
                  />
                  <span
                    className="with-tooltip"
                    tabIndex={0}
                    data-tip="More than 66% of complete generals since they registered"
                  >
                    Likely general
                  </span>
                </label>
                <label title="Registered less than a year">
                  <input
                    type="checkbox"
                    name="newVoter"
                    value="1"
                    defaultChecked={filters.newVoter === "1"}
                  />
                  New voter
                </label>
                <label title="Voters at doors with any result in any wave">
                  <input
                    type="checkbox"
                    name="canvassed"
                    value="1"
                    defaultChecked={filters.canvassed === "1"}
                  />
                  Canvassed
                </label>
              </fieldset>
              <fieldset className="voter-audience-filters">
                <legend className="field-label">Exclude</legend>
                <label title="Doors with an apartment, unit, or suite number">
                  <input
                    type="checkbox"
                    name="noApartments"
                    value="1"
                    defaultChecked={filters.noApartments === "1"}
                  />
                  Apartments
                </label>
                <label title="Voters at doors with any result in any wave">
                  <input
                    type="checkbox"
                    name="excludeCanvassed"
                    value="1"
                    defaultChecked={filters.excludeCanvassed === "1"}
                  />
                  Canvassed
                </label>
                <label title="Voters at doors marked inaccessible in any wave">
                  <input
                    type="checkbox"
                    name="excludeInaccessible"
                    value="1"
                    defaultChecked={filters.excludeInaccessible === "1"}
                  />
                  Inaccessible
                </label>
              </fieldset>
              </div>
              </div>
              <div className="voter-filter-actions">
                <button className="btn btn-primary btn-sm" type="submit">Apply</button>
                <ClearVoterFiltersButton slug={slug} />
                <SavedFilterControls
                  campaignId={directory.campaign.id}
                  slug={slug}
                  currentFilters={persistableFilters}
                  savedFilters={directory.savedFilters}
                />
              </div>
            </form>

            <div className="voter-summary">
              <b>{directory.total.toLocaleString()}</b>
              <span>
                {directory.filtered
                  ? `voter${directory.total === 1 ? "" : "s"} match these filters, out of ${directory.campaignTotal.toLocaleString()} in this campaign`
                  : `voter${directory.total === 1 ? "" : "s"} in this campaign`}
              </span>
              {directory.voters.length ? (
                <span className="voter-summary-range">
                  Showing {firstRow.toLocaleString()}–{lastRow.toLocaleString()}
                </span>
              ) : null}
            </div>

            {directory.voters.length ? (
              <div className="card voter-table-wrap">
                <table className="voter-table">
                  <thead>
                    <tr>
                      <th>Voter</th>
                      <th>Address</th>
                      <th>Precinct</th>
                      <th>Voting history</th>
                      <th>Canvass</th>
                    </tr>
                  </thead>
                  <tbody>
                    {directory.voters.map((voter) => (
                      <tr key={voter.id} className="voter-row">
                        <td>
                          <Link className="voter-row-link" href={`/admin/${slug}/voters/${voter.id}`}>
                            <b>{voter.name}</b>
                            <span>
                              {voter.yearOfBirth ? `Born ${voter.yearOfBirth}` : "Birth year unknown"}
                              {voter.gender ? ` · ${voter.gender}` : ""}
                            </span>
                          </Link>
                        </td>
                        <td>{voter.address}</td>
                        <td>{voter.precinct ?? "—"}</td>
                        <td>
                          {voter.electionCount
                            ? `${voter.electionCount} election${voter.electionCount === 1 ? "" : "s"}`
                            : "No history"}
                          {voter.lastElection ? (
                            <span>Last {formatElection(voter.lastElection)}</span>
                          ) : null}
                        </td>
                        <td>
                          {voter.canvassOutcome ? (
                            <>
                              <span className="voter-canvass-outcome">{voter.canvassOutcome}</span>
                              {voter.canvassProgramName ? (
                                <span>{voter.canvassProgramName}</span>
                              ) : null}
                            </>
                          ) : (
                            <span className="voter-canvass-empty">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="card empty-state voter-empty">
                <Icon name="users" size={28} />
                <b>No voter records found</b>
                <span>
                  {directory.filtered
                    ? "No voters match these filters. Try widening or clearing them."
                    : "Import an authorized Washington VRDB extract for this district before using voter filters."}
                </span>
              </div>
            )}

            {totalPages > 1 ? (
              <nav className="voter-pagination" aria-label="Voter pages">
                {directory.page > 1 ? (
                  <Link className="btn btn-outline btn-sm" href={pageHref(directory.page - 1)}>Previous</Link>
                ) : <span />}
                <span>Page {directory.page} of {totalPages}</span>
                {directory.page < totalPages ? (
                  <Link className="btn btn-outline btn-sm" href={pageHref(directory.page + 1)}>Next</Link>
                ) : <span />}
              </nav>
            ) : null}
      </div>
    </>
  );
}
