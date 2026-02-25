import { createSupabaseServerComponentClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createSupabaseServerComponentClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json([], { status: 401 });

  const { data } = await supabase
    .from("conversations")
    .select("id, title, messages, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  return NextResponse.json(data || []);
}

export async function POST(req: Request) {
  const supabase = createSupabaseServerComponentClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, title, messages } = await req.json();

  if (id) {
    // Update existing
    const { error } = await supabase
      .from("conversations")
      .update({ title, messages, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ id });
  }

  // Create new
  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_id: user.id, title, messages })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data.id });
}

export async function DELETE(req: Request) {
  const supabase = createSupabaseServerComponentClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  await supabase.from("conversations").delete().eq("id", id).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}
