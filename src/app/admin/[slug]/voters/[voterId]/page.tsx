import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { electionTypeLabel } from "@/lib/elections";
import { getSessionUser } from "@/lib/session";
import { getVoterHistoryDetail } from "@/lib/voter-data";

function formatElection(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function percentage(value: number | null): string {
  return value == null ? "Not enough data" : `${Math.round(value * 100)}%`;
}

function participationNote(
  voted: number | null,
  eligible: number | null,
  kind: "primary" | "general",
  registered: string | null,
): string {
  const label =
    eligible === 1
      ? kind === "primary"
        ? "primary"
        : "general"
      : kind === "primary"
        ? "primaries"
        : "generals";
  if (!eligible) {
    return registered
      ? `No complete ${kind} elections since ${formatElection(registered)}`
      : `No complete ${kind} elections on file`;
  }
  const since = registered ? ` since registering ${formatElection(registered)}` : "";
  return `Voted in ${voted ?? 0} of ${eligible} ${label}${since}`;
}

export default async function VoterHistoryPage({
  params,
}: {
  params: Promise<{ slug: string; voterId: string }>;
}) {
  const { slug, voterId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const detail = await getVoterHistoryDetail(slug, voterId, user);
  if (!detail) notFound();

  return (
    <>
      <AdminPageHeader
        title={detail.voter.name}
        subtitle={`Voter ${detail.voter.stateVoterId} · ${detail.campaign.name}`}
        actions={
          <Link className="btn btn-outline btn-sm" href={`/admin/${slug}/voters`}>
            Back to voters
          </Link>
        }
      />
      <div className="admin-content voter-detail">
        <section className="card voter-profile-card">
          <div>
            <span>Address</span>
            <b>{detail.voter.address}</b>
          </div>
          <div>
            <span>Precinct</span>
            <b>{detail.voter.precinct ?? "—"}</b>
          </div>
          <div>
            <span>Birth year</span>
            <b>{detail.voter.yearOfBirth ?? "—"}</b>
          </div>
          <div>
            <span>Gender</span>
            <b>{detail.voter.gender ?? "—"}</b>
          </div>
          <div>
            <span>Registered</span>
            <b>{detail.voter.registrationDate ? formatElection(detail.voter.registrationDate) : "—"}</b>
          </div>
        </section>

        <section className="voter-propensity-grid" aria-label="Voter likelihood">
          <div className="card voter-propensity-card">
            <span>Primary participation</span>
            <b>{percentage(detail.voter.primaryParticipation)}</b>
            <small>
              {participationNote(
                detail.voter.primaryVoted,
                detail.voter.primaryEligible,
                "primary",
                detail.voter.registrationDate,
              )}
              {detail.voter.primaryEligible
                ? ` · ${detail.voter.likelyPrimary ? "Likely primary voter" : "Below likely threshold"}`
                : ""}
            </small>
          </div>
          <div className="card voter-propensity-card">
            <span>General participation</span>
            <b>{percentage(detail.voter.generalParticipation)}</b>
            <small>
              {participationNote(
                detail.voter.generalVoted,
                detail.voter.generalEligible,
                "general",
                detail.voter.registrationDate,
              )}
              {detail.voter.generalEligible
                ? ` · ${detail.voter.likelyGeneral ? "Likely general voter" : "Below likely threshold"}`
                : ""}
            </small>
          </div>
          <p className="voter-propensity-note">
            Counts only elections with a complete statewide ballot list. Recent
            elections still missing a Secretary of State history file are left out
            of both numbers.
          </p>
        </section>

        <section className="card voter-history-card">
          <div className="voter-history-heading">
            <div>
              <h2>Voting history</h2>
              <p>{detail.history.length.toLocaleString()} recorded elections</p>
            </div>
          </div>
          {detail.history.length ? (
            <ul className="voter-history-list">
              {detail.history.map((election) => (
                <li key={election.id}>
                  <time dateTime={election.electionDate}>
                    {formatElection(election.electionDate)}
                  </time>
                  <span className={`election-type election-type-${election.electionType}`}>
                    {electionTypeLabel(election.electionType)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="voter-history-empty">No voting history is available.</p>
          )}
        </section>
      </div>
    </>
  );
}
