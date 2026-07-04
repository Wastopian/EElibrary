"use client";

/**
 * File header: Team members list with admin-mediated password reset.
 *
 * The reset flow is deliberately two-step (Reset -> Confirm) so a stray click never rotates a
 * teammate's password, and the generated temporary password renders exactly once, on the admin's
 * screen only — it is never put in a URL and disappears on the next reset or page load.
 */

import React, { useState, useTransition } from "react";
import { resetMemberPasswordAction, type ResetMemberPasswordResult } from "./actions";

/** TeamMember is the row shape the server page passes down (no hashes, ids only for actions). */
export interface TeamMember {
  id: string;
  email: string;
  role: string;
}

/** MembersPanelProps carries the org's member rows and the acting user's id. */
interface MembersPanelProps {
  members: TeamMember[];
  actingUserId: string;
}

/**
 * Renders the member list; each row can be password-reset by the (admin) viewer after a confirm.
 */
export function MembersPanel({ members, actingUserId }: MembersPanelProps): React.ReactElement {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [result, setResult] = useState<ResetMemberPasswordResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const onReset = (memberId: string) => {
    startTransition(async () => {
      const outcome = await resetMemberPasswordAction(memberId);
      setResult(outcome);
      setConfirmingId(null);
    });
  };

  return (
    <div className="team-members">
      {result?.status === "reset" ? (
        <div className="auth-feedback auth-feedback--success" role="status">
          <strong>Temporary password for {result.email}</strong>
          <p>
            Give this to them directly — it is shown only once:{" "}
            <code className="ui-mono team-members__temp-password">{result.temporaryPassword}</code>
          </p>
          <p>They sign in with it, then pick a new password on their Account page.</p>
        </div>
      ) : null}
      {result?.status === "failed" ? (
        <div className="auth-feedback auth-feedback--error" role="alert">
          <strong>Password reset failed</strong>
          <p>{result.message}</p>
        </div>
      ) : null}

      <table className="data-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Password</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id}>
              <td className="ui-mono">
                {member.email}
                {member.id === actingUserId ? <span className="text-muted"> (you)</span> : null}
              </td>
              <td>{member.role === "admin" ? "Admin" : "User"}</td>
              <td>
                {member.id === actingUserId ? (
                  <a className="button-link button-link--quiet" href="/account">
                    Change on your Account page
                  </a>
                ) : confirmingId === member.id ? (
                  <span className="team-members__confirm">
                    <button className="link-button" disabled={isPending} onClick={() => onReset(member.id)} type="button">
                      {isPending ? "Resetting…" : `Yes, reset ${member.email}`}
                    </button>
                    <button className="link-button" disabled={isPending} onClick={() => setConfirmingId(null)} type="button">
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button className="link-button" onClick={() => { setResult(null); setConfirmingId(member.id); }} type="button">
                    Reset password
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="form-hint">
        Resetting gives the teammate a temporary password you hand to them directly. Their current password stops
        working immediately, and they should change the temporary one on their Account page after signing in.
      </p>
    </div>
  );
}
