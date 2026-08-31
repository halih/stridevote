import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Icon } from "@/components/Icon";
import { getSessionUser } from "@/lib/session";
import {
  getCampaignVoterDirectory,
  type VoterFilters,
} from "@/lib/voter-data";

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
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
    page: one(raw.page),
  };
  const directory = await getCampaignVoterDirectory(slug, user, filters);
  if (!directory) notFound();

  function pageHref(page: number): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value && key !== "page") query.set(key, value);
    }
    query.set("page", String(page));
    return `/admin/${slug}/voters?${query}`;
  }

  const totalPages = Math.max(1, Math.ceil(directory.total / directory.pageSize));

  return (
    <>
      <AdminPageHeader
        title={`${directory.campaign.name} voters`}
        subtitle={`${directory.total.toLocaleString()} filtered voter${directory.total === 1 ? "" : "s"} · ${directory.campaign.district}`}
      />
      <div className="admin-content">
        <Link href={`/admin/${slug}`} className="back-link">
          <Icon name="chevronLeft" size={15} /> Campaign
        </Link>

        <div className="campaign-admin-workspace">
          <aside className="campaign-section-nav" aria-label="Campaign sections">
            <Link href={`/admin/${slug}?section=members`}><Icon name="users" size={17} /> Members</Link>
            <Link href={`/admin/${slug}?section=turfs`}><Icon name="map" size={17} /> Turf map</Link>
            <Link href={`/admin/${slug}?section=lists`}><Icon name="list" size={17} /> Lists</Link>
            <Link href={`/admin/${slug}?section=settings`}><Icon name="pencil" size={17} /> Settings</Link>
            <Link href={`/admin/${slug}/voters`} className="active"><Icon name="contact" size={17} /> Voters</Link>
          </aside>

          <div className="campaign-admin-panel">
            <div className="voter-legal-note">
              Washington voter-file data may be used only for lawful political
              purposes and must not be used commercially.
            </div>

            <form className="card voter-filters" method="get">
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
                    <option key={precinct} value={precinct}>{precinct}</option>
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
              <div className="form-field">
                <label className="field-label">Voted in</label>
                <select className="field" name="election" defaultValue={filters.election}>
                  <option value="">Any election</option>
                  {directory.elections.map((election) => (
                    <option key={election} value={election}>{election}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label className="field-label">Minimum age</label>
                <input className="field" type="number" min={18} name="minAge" defaultValue={filters.minAge} />
              </div>
              <div className="form-field">
                <label className="field-label">Maximum age</label>
                <input className="field" type="number" min={18} name="maxAge" defaultValue={filters.maxAge} />
              </div>
              <div className="voter-filter-actions">
                <button className="btn btn-primary" type="submit">Apply filters</button>
                <Link className="btn btn-outline" href={`/admin/${slug}/voters`}>Clear</Link>
              </div>
            </form>

            {directory.voters.length ? (
              <div className="card voter-table-wrap">
                <table className="voter-table">
                  <thead>
                    <tr>
                      <th>Voter</th>
                      <th>Address</th>
                      <th>Precinct</th>
                      <th>History</th>
                    </tr>
                  </thead>
                  <tbody>
                    {directory.voters.map((voter) => (
                      <tr key={voter.id}>
                        <td>
                          <b>{voter.name}</b>
                          <span>
                            {voter.yearOfBirth ? `Born ${voter.yearOfBirth}` : "Birth year unknown"}
                            {voter.gender ? ` · ${voter.gender}` : ""}
                          </span>
                        </td>
                        <td>{voter.address}</td>
                        <td>{voter.precinct ?? "—"}</td>
                        <td>
                          {voter.electionsVoted.length
                            ? `${voter.electionsVoted.length} elections`
                            : "No history"}
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
                  Import an authorized Washington VRDB extract for this district
                  before using voter filters.
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
        </div>
      </div>
    </>
  );
}
