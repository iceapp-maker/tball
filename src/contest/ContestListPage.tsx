import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';

const user = JSON.parse(localStorage.getItem('loginUser') || '{}');

interface Contest {
  contest_id: number;
  contest_name: string;
  team_name: string;
  created_by: string;
  rule_text: string;
  signup_end_date: string;
  expected_teams: string;
  players_per_team: string;
  contest_status: string;
}

interface TeamMemberCount {
  contest_id: number;
  contest_team_id: number;
  team_id: string;
  team_name: string;
  member_count: number;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  recruiting: { label: '招募中', color: 'bg-blue-500' },
  lineup_arrangement: { label: '名單安排中', color: 'bg-yellow-500' },
  ongoing: { label: '比賽進行中', color: 'bg-green-500' },
  finished: { label: '比賽已結束', color: 'bg-gray-500' },
};

const TEAM_NAMES: Record<string, string> = {
  'F': '復華',
  'M': '明興',
  'T': '測試',
};

const ContestListPage: React.FC = () => {
  const [contests, setContests] = useState<Contest[]>([]);
  const [teamCounts, setTeamCounts] = useState<TeamMemberCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [teamName, setTeamName] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchTeamName = async () => {
      if (user?.team_id) {
        const { data } = await supabase
          .from('courts')
          .select('name')
          .eq('team_id', user.team_id)
          .maybeSingle();
        setTeamName(data?.name || user.team_id);
      }
    };
    fetchTeamName();
  }, [user?.team_id]);

  useEffect(() => {
    const fetchContests = async () => {
      setLoading(true);
      const { data: courtData } = await supabase
        .from('courts')
        .select('team_id, name')
        .eq('team_id', user.team_id)
        .maybeSingle();

      if (courtData) {
        const { data, error } = await supabase
          .from('contest')
          .select('*')
          .eq('team_name', courtData.name)
          .order('contest_id', { ascending: false });

        if (error) {
          setError(error.message);
        } else {
          setContests(data || []);
        }
      }
      setLoading(false);
    };
    fetchContests();
  }, []);

  useEffect(() => {
    const fetchTeamCounts = async () => {
      const { data, error } = await supabase
        .from('vw_contest_team_member_count')
        .select('*');
      if (!error) setTeamCounts(data || []);
    };
    fetchTeamCounts();
  }, []);

  return (
    <div>
      <div className="p-4 bg-gray-100 flex justify-end items-center">
        <span className="text-gray-600">登入者：{user.name || '未登入'}（{teamName}隊）</span>
      </div>
      <div className="max-w-2xl mx-auto mt-8 p-6 bg-white rounded shadow">
        <h2 className="text-2xl font-bold mb-4">參賽區</h2>
        {loading && <div>載入中...</div>}
        {error && <div className="text-red-600">{error}</div>}
        {!loading && contests.length === 0 && <div>目前沒有比賽。</div>}
        <ul>
          {contests.map(contest => (
            <li key={contest.contest_id} className="mb-4 p-4 border rounded bg-gray-50 relative">
              <button
                className="absolute top-4 right-24 bg-blue-600 hover:bg-blue-700 text-white px-4 py-1 rounded text-sm shadow"
                onClick={async () => {
                  const { data: teams, error: teamErr } = await supabase
                    .from('contest_team')
                    .select('contest_team_id, team_name')
                    .eq('contest_id', contest.contest_id);
                  if (teamErr) {
                    alert('隊伍查詢失敗: ' + teamErr.message);
                    return;
                  }
                  const { data: members, error: memberErr } = await supabase
                    .from('contest_team_member')
                    .select('contest_team_id, member_name, status')
                    .eq('contest_id', contest.contest_id);
                  if (memberErr) {
                    alert('成員查詢失敗: ' + memberErr.message);
                    return;
                  }
                  const teamsMap: { [key: string]: any } = {};
                  teams.forEach(t => { teamsMap[t.contest_team_id] = { name: t.team_name, members: [] }; });
                  members.forEach(m => {
                    if (teamsMap[m.contest_team_id]) {
                      teamsMap[m.contest_team_id].members.push(m);
                    }
                  });
                  let msg = `<div style='max-height:70vh;overflow:auto;width:100vw;max-width:400px;padding:8px;'>`;
                  msg += `<div style='font-weight:bold;margin-bottom:8px;'>【${contest.contest_name}】隊伍與成員名單</div>`;
                  Object.values(teamsMap).forEach((team: any) => {
                    const sortedMembers = [...team.members].sort((a, b) => {
                      if (a.status === 'captain') return -1;
                      if (b.status === 'captain') return 1;
                      return 0;
                    });
                    msg += `<div style='margin-bottom:8px;'><b>隊伍名稱：${team.name}</b><br/>成員列表：<ul style='margin:0 0 0 12px;padding:0;'>`;
                    sortedMembers.forEach((m: any) => {
                      let statusLabel = '';
                      if (m.status === 'captain') statusLabel = '（隊長）';
                      else if (m.status === 'invited') statusLabel = '（邀請中）';
                      else if (m.status === 'pending') statusLabel = '（待回覆）';
                      else if (m.status === 'accepted') statusLabel = '（已接受）';
                      else if (m.status === 'reject') statusLabel = '（謝絕）';
                      msg += `<li>${m.member_name}${statusLabel}</li>`;
                    });
                    msg += `</ul></div>`;
                  });
                  msg += `</div>`;
                  const modal = document.createElement('div');
                  modal.style.position = 'fixed';
                  modal.style.top = '0';
                  modal.style.left = '0';
                  modal.style.width = '100vw';
                  modal.style.height = '100vh';
                  modal.style.background = 'rgba(0,0,0,0.3)';
                  modal.style.display = 'flex';
                  modal.style.alignItems = 'center';
                  modal.style.justifyContent = 'center';
                  modal.style.zIndex = '9999';
                  modal.innerHTML = `<div style='background:#fff;border-radius:12px;max-width:400px;width:90vw;padding:18px 12px 12px 12px;box-shadow:0 2px 12px #0002;overflow:auto;max-height:75vh;'>${msg}<button id='close-member-list-modal' style='margin:16px auto 0 auto;display:block;background:#6c63ff;color:#fff;border:none;border-radius:6px;padding:8px 24px;font-size:1rem;'>確定</button></div>`;
                  document.body.appendChild(modal);
                  document.getElementById('close-member-list-modal')?.addEventListener('click', () => {
                    document.body.removeChild(modal);
                  });
                }}
              >
                成員名單
              </button>
              {user.role === 'admin' && (
                <button
                  className="absolute top-4 right-44 bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-1 rounded text-sm shadow"
                  onClick={() => navigate(`/contest/edit/${contest.contest_id}`)}
                >
                  編輯
                </button>
              )}
              <button
                className="absolute top-4 right-4 bg-green-600 hover:bg-green-700 text-white px-4 py-1 rounded text-sm shadow"
                onClick={() => window.location.href = 
                  (contest.contest_status === 'ongoing' || contest.contest_status === 'lineup_arrangement') 
                    ? `/contest/${contest.contest_id}/battleroom` 
                    : `/contest/${contest.contest_id}/join`}
              >
                {(contest.contest_status === 'ongoing' || contest.contest_status === 'lineup_arrangement') 
                  ? '戰況室' 
                  : '參賽'}
              </button>
              <div className="mb-2">
                <div className="font-bold text-lg">
                  {contest.contest_name}
                </div>
                <div className="mt-1">
                  <span className={`px-2 py-0.5 rounded text-white text-xs ${STATUS_MAP[contest.contest_status]?.color || 'bg-gray-400'}`}>
                    {STATUS_MAP[contest.contest_status]?.label || contest.contest_status}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-4">
                <div>球場：{contest.team_name}</div>
                <div>建立者：{contest.created_by}</div>
                <div>報名截止日：{contest.signup_end_date}</div>
                <div>預計隊伍數：{contest.expected_teams}</div>
              </div>
              
              {/* 隊伍資訊區塊 - 只在有隊伍數據時顯示 */}
              {teamCounts.filter(tc => tc.contest_id === contest.contest_id).length > 0 && (
                <div className="mt-3 border-t pt-2">
                  <div className="text-gray-600 mb-1">預計每隊人數：{contest.players_per_team} 人</div>
                  <div className="grid grid-cols-2 gap-x-2">
                    {teamCounts.filter(tc => tc.contest_id === contest.contest_id).map(team => (
                      <div key={team.contest_team_id} className="text-sm">
                        <span className="font-medium">{team.team_name}：</span>
                        <span>{team.member_count} 人</span>
                        {team.member_count === parseInt(contest.players_per_team) && (
                          <span className="ml-1 text-green-600">✓</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* 比賽規則按鈕 */}
              <div className="mt-3">
                <button 
                  className="text-blue-600 hover:text-blue-800 text-sm flex items-center"
                  onClick={() => {
                    const modal = document.createElement('div');
                    modal.style.position = 'fixed';
                    modal.style.top = '0';
                    modal.style.left = '0';
                    modal.style.width = '100%';
                    modal.style.height = '100%';
                    modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
                    modal.style.display = 'flex';
                    modal.style.justifyContent = 'center';
                    modal.style.alignItems = 'center';
                    modal.style.zIndex = '1000';
                    modal.innerHTML = `
                      <div style="background:white;padding:20px;border-radius:8px;max-width:600px;width:90%;position:relative;">
                        <button style="position:absolute;top:10px;right:10px;border:none;background:none;font-size:20px;cursor:pointer;">×</button>
                        <h3 style="margin-top:0;font-size:18px;margin-bottom:10px;">比賽規則</h3>
                        <div style="max-height:70vh;overflow:auto;white-space:pre-wrap;">${contest.rule_text}</div>
                      </div>
                    `;
                    document.body.appendChild(modal);
                    const closeButton = modal.querySelector('button');
                    if (closeButton) {
                      closeButton.addEventListener('click', () => {
                        document.body.removeChild(modal);
                      });
                    }
                  }}
                >
                  <span className="mr-1">▶</span> 比賽規則
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default ContestListPage;