import { createSupabaseServerComponentClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function requireAdmin() {
  const supabase = createSupabaseServerComponentClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  return profile?.is_admin ? user : null;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json([], { status: 403 });

  const service = getServiceClient();
  const { data: profiles } = await service
    .from("user_profiles")
    .select("id, email, is_admin, is_approved, created_at")
    .order("created_at", { ascending: true });

  if (!profiles) return NextResponse.json([]);

  // Get conversation counts
  const { data: counts } = await service
    .from("conversations")
    .select("user_id");

  const countMap: Record<string, number> = {};
  counts?.forEach((c: { user_id: string }) => {
    countMap[c.user_id] = (countMap[c.user_id] || 0) + 1;
  });

  const users = profiles.map((p) => ({
    ...p,
    conversation_count: countMap[p.id] || 0,
  }));

  return NextResponse.json(users);
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { email, password } = await req.json();
  const service = getServiceClient();

  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Auto-approve admin-created users
  if (data.user) {
    await service.from("user_profiles").update({ is_approved: true }).eq("id", data.user.id);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId } = await req.json();
  const service = getServiceClient();

  // Delete conversations first
  await service.from("conversations").delete().eq("user_id", userId);
  await service.from("user_profiles").delete().eq("id", userId);
  const { error } = await service.auth.admin.deleteUser(userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId, is_admin, is_approved } = await req.json();
  const service = getServiceClient();

  const updates: Record<string, any> = {};
  if (typeof is_admin === "boolean") updates.is_admin = is_admin;
  if (typeof is_approved === "boolean") updates.is_approved = is_approved;

  const { error } = await service
    .from("user_profiles")
    .update(updates)
    .eq("id", userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
