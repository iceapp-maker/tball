require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

// 用 .env 變數
const supabaseUrl = process.env.IPABASE_URL;
const supabaseKey = process.env.IPABASE_ANON_KEY; // 若有 service_role_key 建議用

const supabase = createClient(supabaseUrl, supabaseKey);

async function updatePasswordHashes() {
  // 只選取 team_id 為 'M' 的會員
  const { data: members, error } = await supabase
    .from('members')
    .select('id, member_id')
    .eq('team_id', 'M');

  if (error) throw error;

  for (const member of members) {
    const hash = await bcrypt.hash(member.member_id, 10);
    await supabase
      .from('members')
      .update({ password_hash: hash })
      .eq('id', member.id);
    console.log(`Updated member_id ${member.member_id} with hashed password.`);
  }
}

updatePasswordHashes();