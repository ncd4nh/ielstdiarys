// Trả cấu hình Supabase công khai cho trình duyệt (URL + anon/publishable key — loại key được phép lộ ra ngoài).
// Đặt trong Vercel → Settings → Environment Variables: SUPABASE_URL và SUPABASE_ANON_KEY.
module.exports = (req, res) => {
  const e = process.env;
  res.setHeader("cache-control", "no-store");
  res.status(200).json({
    supabaseUrl: e.SUPABASE_URL || e.NEXT_PUBLIC_SUPABASE_URL || "",
    supabaseKey: e.SUPABASE_ANON_KEY || e.SUPABASE_PUBLISHABLE_KEY || e.NEXT_PUBLIC_SUPABASE_ANON_KEY || e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ""
  });
};
