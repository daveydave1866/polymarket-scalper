import { useState } from "react";
import { Users, Plus, Trash2, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { getStoredToken } from "@/lib/auth";

interface User {
  id: string;
  username: string;
  role: string;
  createdAt: string;
}

function useAdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${getStoredToken()}` },
      });
      const data = await res.json() as { users?: User[]; error?: string };
      if (!res.ok) { setError(data.error ?? "Failed to load users"); return; }
      setUsers(data.users ?? []);
    } catch {
      setError("Could not reach server.");
    } finally {
      setLoading(false);
    }
  }

  return { users, loading, error, load, setUsers };
}

export default function Admin() {
  const { users, loading, error, load, setUsers } = useAdminUsers();
  const [loaded, setLoaded] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"user" | "admin">("user");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [actionMsg, setActionMsg] = useState("");

  function init() {
    if (!loaded) { setLoaded(true); load(); }
  }

  if (!loaded) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <h1 className="font-mono text-xs font-bold uppercase tracking-widest text-foreground">User Management</h1>
        </div>
        <button
          onClick={init}
          className="font-mono text-xs uppercase tracking-widest border border-border px-4 py-2 hover:border-primary hover:text-primary transition-colors"
        >
          Load Users
        </button>
      </div>
    );
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) return;
    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getStoredToken()}` },
        body: JSON.stringify({ username: newUsername.trim(), password: newPassword, role: newRole }),
      });
      const data = await res.json() as { user?: User; error?: string };
      if (!res.ok) { setCreateError(data.error ?? "Failed to create user"); return; }
      setUsers(prev => [...prev, data.user!]);
      setNewUsername("");
      setNewPassword("");
      setNewRole("user");
      setActionMsg(`User "${data.user!.username}" created.`);
      setTimeout(() => setActionMsg(""), 3000);
    } catch {
      setCreateError("Could not reach server.");
    } finally {
      setCreating(false);
    }
  }

  async function deleteUser(id: string, username: string) {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getStoredToken()}` },
      });
      if (!res.ok) { const d = await res.json() as { error?: string }; alert(d.error ?? "Failed to delete"); return; }
      setUsers(prev => prev.filter(u => u.id !== id));
      setActionMsg(`User "${username}" deleted.`);
      setTimeout(() => setActionMsg(""), 3000);
    } catch {
      alert("Could not reach server.");
    }
  }

  async function resetPassword(id: string, username: string) {
    const pw = prompt(`New password for "${username}" (min 8 chars):`);
    if (!pw || pw.length < 8) { if (pw !== null) alert("Password must be at least 8 characters."); return; }
    try {
      const res = await fetch(`/api/admin/users/${id}/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getStoredToken()}` },
        body: JSON.stringify({ password: pw }),
      });
      if (!res.ok) { const d = await res.json() as { error?: string }; alert(d.error ?? "Failed"); return; }
      setActionMsg(`Password reset for "${username}".`);
      setTimeout(() => setActionMsg(""), 3000);
    } catch {
      alert("Could not reach server.");
    }
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-4 h-4 text-primary" />
        <h1 className="font-mono text-xs font-bold uppercase tracking-widest text-foreground">User Management</h1>
      </div>

      {actionMsg && (
        <div className="border border-primary/40 bg-primary/5 px-4 py-2 font-mono text-xs text-primary uppercase tracking-wider">
          {actionMsg}
        </div>
      )}

      <div className="border border-border bg-card p-6 space-y-4">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Users className="w-3 h-3" /> Active Users
        </div>
        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading…
          </div>
        )}
        {error && <div className="text-xs text-destructive font-mono uppercase">{error}</div>}
        {!loading && users.length === 0 && (
          <div className="text-xs text-muted-foreground font-mono">No users found.</div>
        )}
        <div className="space-y-2">
          {users.map(u => (
            <div key={u.id} className="flex items-center justify-between border border-border/40 px-4 py-3">
              <div>
                <div className="font-mono text-sm font-bold text-foreground">{u.username}</div>
                <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">
                  {u.role} · joined {new Date(u.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => resetPassword(u.id, u.username)}
                  title="Reset password"
                  className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => deleteUser(u.id, u.username)}
                  title="Delete user"
                  className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border border-border bg-card p-6 space-y-4">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Plus className="w-3 h-3" /> Create New User
        </div>
        <form onSubmit={createUser} className="space-y-3">
          <input
            type="text"
            value={newUsername}
            onChange={e => setNewUsername(e.target.value)}
            placeholder="Username"
            className="w-full bg-background border border-border text-foreground font-mono text-sm px-3 py-2 outline-none focus:border-primary placeholder:text-muted-foreground/40"
          />
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="Password (min 8 chars)"
            className="w-full bg-background border border-border text-foreground font-mono text-sm px-3 py-2 outline-none focus:border-primary placeholder:text-muted-foreground/40"
          />
          <div className="flex items-center gap-3">
            <label className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Role:</label>
            <select
              value={newRole}
              onChange={e => setNewRole(e.target.value as "user" | "admin")}
              className="bg-background border border-border text-foreground font-mono text-xs px-3 py-2 outline-none focus:border-primary"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {createError && <div className="text-xs text-destructive font-mono uppercase">{createError}</div>}
          <button
            type="submit"
            disabled={creating || !newUsername.trim() || !newPassword.trim()}
            className="flex items-center gap-2 bg-primary text-primary-foreground font-mono text-xs font-bold uppercase tracking-widest px-4 py-2 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            {creating ? "Creating…" : "Create User"}
          </button>
        </form>
      </div>
    </div>
  );
}
