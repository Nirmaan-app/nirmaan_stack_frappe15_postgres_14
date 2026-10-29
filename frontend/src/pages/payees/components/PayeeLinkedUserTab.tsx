/**
 * The Payee page's Linked User tab: the person whose own bank account this is (`Nirmaan Users.payee`), into
 * which their Reimbursements are paid (ADR-0033 Amendment B). At most one person holds a Payee. Only that
 * person links an account to themselves, from Raise Reimbursement, so this tab shows the link and never changes it.
 */

import { Link } from "react-router-dom";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PayeeLinkedUser } from "@/types/NirmaanStack/Payee";

/** "Nirmaan Project Manager Profile" -> "Project Manager". */
const roleLabel = (profile?: string | null) => (profile ?? "").replace(/^Nirmaan\s+/, "").replace(/\s+Profile$/, "") || "--";

export function PayeeLinkedUserTab({ user }: { user: PayeeLinkedUser | null }) {
    return (
        <div className="flex flex-col gap-2.5">
            <p className="text-sm text-zinc-600">
                This person's reimbursements can be paid into this account. They added it as their own bank account themselves.
            </p>
            <div className="overflow-x-auto rounded-md border">
                <Table className="min-w-[520px]">
                    <TableHeader>
                        <TableRow>
                            <TableHead>User</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Role</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {!user ? (
                            <TableRow>
                                <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                                    This account isn't any user's own bank account.
                                </TableCell>
                            </TableRow>
                        ) : (
                            <TableRow>
                                <TableCell className="font-medium">
                                    <Link to={`/users/${encodeURIComponent(user.name)}`} className="text-blue-600 hover:underline">
                                        {user.full_name || user.name}
                                    </Link>
                                </TableCell>
                                <TableCell>{user.name}</TableCell>
                                <TableCell>{roleLabel(user.role_profile)}</TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
