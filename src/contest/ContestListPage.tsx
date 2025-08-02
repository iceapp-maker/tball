import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';
import { Modal, Button } from 'antd';

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
  parent_contest_id?: number; // Optional, for child contests
  table_count?: number; // Added as per your generateRoundRobinMatches usage
  total_points?: number; // Added as per your generateRoundRobinMatches usage
  points_config?: any; // Added as per your generateRoundRobinMatches usage
}

interface TeamMemberCount {
  contest_id: number;
  contest_team_id: number;
  team_id: string;
  team_name: string;
  member_count: number;
}

interface TeamMemberStatus {
  contest_team_id: number;
  team_member_status: string;
  contest_id: number;
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  recruiting: { label: '招募中', color: 'bg-blue-500' },
  WaitMatchForm: { label: '等待對戰表', color: 'bg-orange-500' },
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
  const [teamStatuses, setTeamStatuses] = useState<TeamMemberStatus[]>([]);
  const [allTeamsReady, setAllTeamsReady] = useState<{[key: number]: boolean}>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [teamName, setTeamName] = useState('');
  const [generatingSchedule, setGeneratingSchedule] = useState(false);
  const [generatingContestId, setGeneratingContestId] = useState<number | null>(null);
  const [showFinishedContests, setShowFinishedContests] = useState(false);
  // New state for collapsed parent contests
  const [collapsedParentContests, setCollapsedParentContests] = useState<{[key: number]: boolean}>({});
  // QR碼相關狀態
  const [qrCodeModalOpen, setQrCodeModalOpen] = useState(false);
  const [qrCodeData, setQrCodeData] = useState('');
  const [currentInviteMemberName, setCurrentInviteMemberName] = useState('');
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
          console.error('Error fetching contests:', error);
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
      if (error) {
        console.error('Error fetching team counts:', error);
      } else {
        setTeamCounts(data || []);
      }
    };
    fetchTeamCounts();
  }, []);

  useEffect(() => {
    const fetchTeamStatuses = async () => {
      const { data, error } = await supabase
        .from('contest_team')
        .select('contest_team_id, team_member_status, contest_id');
      
      if (!error && data) {
        setTeamStatuses(data);
        
        const contestTeamsMap: {[key: number]: TeamMemberStatus[]} = {};
        
        data.forEach(team => {
          if (!contestTeamsMap[team.contest_id]) {
            contestTeamsMap[team.contest_id] = [];
          }
          contestTeamsMap[team.contest_id].push(team);
        });
        
        const readyStatus: {[key: number]: boolean} = {};
        Object.entries(contestTeamsMap).forEach(([contestId, teams]) => {
          readyStatus[Number(contestId)] = teams.length > 0 && 
                                           teams.every(team => team.team_member_status === 'done');
        });
        
        setAllTeamsReady(readyStatus);
      } else if (error) {
        console.error('Error fetching team statuses:', error);
      }
    };
    fetchTeamStatuses();
  }, []);

  // Sort and group contests
  const groupedContests = contests.reduce((acc, contest) => {
    if (contest.parent_contest_id) {
      // Child contest
      if (!acc[contest.parent_contest_id]) {
        acc[contest.parent_contest_id] = { parent: undefined, children: [] };
      }
      acc[contest.parent_contest_id].children.push(contest);
    } else {
      // Parent or standalone contest
      if (!acc[contest.contest_id]) {
        acc[contest.contest_id] = { parent: undefined, children: [] };
      }
      acc[contest.contest_id].parent = contest;
    }
    return acc;
  }, {} as {[key: number]: {parent?: Contest, children: Contest[]}});

  // Convert grouped contests to a flat array for sorting,
  // ensuring parents are always before their children, and then sort by status and ID
  const sortedAndGroupedContests: (Contest | { type: 'parent', contest: Contest, children: Contest[] })[] = [];
  
  Object.values(groupedContests).forEach(group => {
    if (group.parent) {
      sortedAndGroupedContests.push({
        type: 'parent',
        contest: group.parent,
        children: group.children.sort((a,b) => b.contest_id - a.contest_id) // Sort children by ID desc
      });
    } else {
      // Handle cases where a child might be listed without its parent being fetched yet,
      // or if it's an orphaned child (shouldn't happen with proper data integrity)
      group.children.forEach(child => sortedAndGroupedContests.push(child));
    }
  });

  const finalSortedContests = sortedAndGroupedContests.sort((a, b) => {
    const getContestStatus = (item: any) => item.type === 'parent' ? item.contest.contest_status : item.contest_status;
    const getContestId = (item: any) => item.type === 'parent' ? item.contest.contest_id : item.contest_id;

    const statusPriority: Record<string, number> = {
      ongoing: 1,
      lineup_arrangement: 2,
      recruiting: 3,
      WaitMatchForm: 4,
      finished: 5
    };
    
    const priorityA = statusPriority[getContestStatus(a)] || 6;
    const priorityB = statusPriority[getContestStatus(b)] || 6;
    
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    
    // Within the same status, sort by parent_contest_id first (parents before children)
    // Then by contest_id descending
    const isAParent = a.type === 'parent';
    const isBParent = b.type === 'parent';

    if (isAParent && !isBParent && (b as Contest).parent_contest_id === (a as { type: 'parent', contest: Contest, children: Contest[] }).contest.contest_id) {
        return -1; // A is parent of B, A comes first
    }
    if (!isAParent && isBParent && (a as Contest).parent_contest_id === (b as { type: 'parent', contest: Contest, children: Contest[] }).contest.contest_id) {
        return 1; // B is parent of A, B comes first
    }

    return getContestId(b) - getContestId(a);
  });

  // Separate finished and active contests (including their children)
  const activeContests: typeof finalSortedContests = [];
  const finishedContests: typeof finalSortedContests = [];

  finalSortedContests.forEach(item => {
    const contestStatus = item.type === 'parent' ? item.contest.contest_status : item.contest_status;
    if (contestStatus === 'finished') {
      finishedContests.push(item);
    } else {
      activeContests.push(item);
    }
  });


  // Toggle collapse state for parent contests
  const toggleCollapse = (contestId: number) => {
    setCollapsedParentContests(prev => ({
      ...prev,
      [contestId]: !prev[contestId]
    }));
  };

  // 生成QR碼邀請功能
  const generateQRInvite = (memberId: string, memberName: string, contestId: number, teamId: string) => {
    // 檢查是否為隊長或管理員
    if (user.role !== 'admin') {
      // 需要檢查是否為該隊伍的隊長
      // 這裡可以加入隊長檢查邏輯
    }
    
    // 生成邀請數據
    const inviteData = {
      contest_id: contestId,
      team_id: teamId,
      member_id: memberId,
      timestamp: new Date().toISOString()
    };

    console.log('生成QR碼邀請數據:', inviteData);

    // 編碼邀請數據
    const encodedData = btoa(JSON.stringify(inviteData));
    
    // 生成邀請URL - 使用相對位置
    const baseUrl = window.location.origin;
    const inviteUrl = `${baseUrl}/qr-join?data=${encodedData}`;
    
    // 使用 Google Charts API 生成QR碼
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(inviteUrl)}`;
    
    console.log('QR碼URL:', qrCodeUrl);
    console.log('邀請URL:', inviteUrl);
    console.log('QR碼內容數據:', {
      contest_id: inviteData.contest_id,
      team_id: inviteData.team_id,
      member_id: inviteData.member_id,
      timestamp: inviteData.timestamp,
      encodedData: encodedData
    });
    
    setQrCodeData(qrCodeUrl);
    setCurrentInviteMemberName(memberName);
    setQrCodeModalOpen(true);
  };

  // Generate Round Robin Matches function
  const handleGenerateSchedule = async (contestId: number) => {
    if (!confirm('確定要產生對戰表嗎？產生後將無法更改隊伍名單。')) {
      return;
    }

    setGeneratingSchedule(true);
    setGeneratingContestId(contestId);

    try {
      const { data: contestData, error: contestError } = await supabase
        .from('contest')
        .select('*')
        .eq('contest_id', contestId)
        .single();

      if (contestError) throw contestError;
      if (!contestData) throw new Error('找不到比賽資訊');

      const { data: teamsData, error: teamsError } = await supabase
        .from('contest_team')
        .select('*')
        .eq('contest_id', contestId);

      if (teamsError) throw teamsError;
      if (!teamsData || teamsData.length < 2) {
        throw new Error('參賽隊伍不足，至少需要2支隊伍');
      }

      const matches = generateRoundRobinMatches(teamsData, contestData.table_count || 1);

      const { data: matchesData, error: matchesError } = await supabase
        .from('contest_match')
        .insert(matches)
        .select();

      if (matchesError) throw matchesError;

      if (matchesData) {
        for (const match of matchesData) {
          // Ensure contestData.total_points and contestData.points_config are handled
          const totalPoints = contestData.total_points || 0; 
          const pointsConfig = contestData.points_config || [];

          for (let i = 0; i < totalPoints; i++) {
            const matchDetail = {
              match_id: match.match_id,
              contest_id: contestData.contest_id,
              team1_member_ids: [],
              team2_member_ids: [],
              winner_team_id: null,
              score: null,
              sequence: i + 1,
              match_type: pointsConfig[i] && pointsConfig[i].type
                ? pointsConfig[i].type
                : '雙打',
              table_no: null,
              judge_id: null
            };

            const { error: detailError } = await supabase
              .from('contest_match_detail')
              .insert([matchDetail]);

            if (detailError) {
              console.error('新增比賽詳情失敗:', detailError, matchDetail);
            }
          }
        }
      }

      await supabase
        .from('contest')
        .update({ contest_status: 'lineup_arrangement' })
        .eq('contest_id', contestId);

      alert('對戰表產生成功！');
      setContests(contests.map(contest =>
        contest.contest_id === contestId
          ? { ...contest, contest_status: 'lineup_arrangement' }
          : contest
      ));
    } catch (err: any) {
      console.error('產生對戰表失敗:', err);
      alert(`產生對戰表失敗: ${err.message}`);
    } finally {
      setGeneratingSchedule(false);
      setGeneratingContestId(null);
    }
  };

  const generateRoundRobinMatches = (teams: any[], tableCount: number) => {
    const matches = [];
    let tableNo = 1;
    let sequence = 1;
    
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const team1Id = typeof teams[i].contest_team_id === 'string' ? parseInt(teams[i].contest_team_id) : teams[i].contest_team_id;
        const team2Id = typeof teams[j].contest_team_id === 'string' ? parseInt(teams[j].contest_team_id) : teams[j].contest_team_id;
        const contestId = typeof teams[i].contest_id === 'string' ? parseInt(teams[i].contest_id) : teams[i].contest_id;
        
        matches.push({
          contest_id: contestId,
          team1_id: team1Id,
          team2_id: team2Id,
          winner_team_id: null,
          match_date: new Date().toISOString().split('T')[0],
          score: null,
          sequence: sequence
        });
        
        sequence++;
        tableNo++;
        if (tableNo > tableCount) tableNo = 1;
      }
    }
    return matches;
  };

  const renderContestCard = (contest: Contest, isChild: boolean = false) => (
    <li key={contest.contest_id} className={`mb-4 p-4 border rounded relative ${isChild ? 'ml-8 bg-blue-50 border-blue-200' : 'bg-gray-50'}`}>
      <button
        className="absolute top-4 right-24 bg-blue-600 hover:bg-blue-700 text-white px-4 py-1 rounded text-sm shadow"
        onClick={async () => {
          let teams: any[] | null = [];
          let members: any[] | null = [];
          let teamErr: any = null;
          let memberErr: any = null;

          // 判斷是否為子賽事
          if (contest.parent_contest_id) {
            // **子賽事邏輯：透過 contest_group_assignment 橋接**
            console.log(`Fetching data for child contest_id: ${contest.contest_id}`); // Debug
            
            const { data: groupAssignments, error: assignError } = await supabase
              .from('contest_group_assignment')
              .select('contest_team_id')
              .eq('group_contest_id', contest.contest_id);

            if (assignError) {
              alert('查詢子賽事隊伍對應失敗: ' + assignError.message);
              console.error('Error fetching group assignments:', assignError);
              return;
            }

            console.log('Group Assignments:', groupAssignments); // Debug

            if (groupAssignments && groupAssignments.length > 0) {
              const teamIds = groupAssignments.map(ga => ga.contest_team_id);
              console.log('Fetching teams for teamIds:', teamIds); // Debug

              // 查詢 contest_team 表
              const { data: fetchedTeams, error: fetchedTeamsError } = await supabase
                .from('contest_team')
                .select('contest_team_id, team_name, team_member_status')
                .in('contest_team_id', teamIds); // 使用 in 查詢多個 team_id

              if (fetchedTeamsError) {
                teamErr = fetchedTeamsError;
              } else {
                teams = fetchedTeams;
              }

              console.log(`Child Contest ${contest.contest_id} Teams Data:`, teams); // Debug

              // 查詢 contest_team_member 表
              const { data: fetchedMembers, error: fetchedMembersError } = await supabase
                .from('contest_team_member')
                .select('contest_team_id, member_id, member_name, status')
                .in('contest_team_id', teamIds); // 使用 in 查詢多個 team_id

              if (fetchedMembersError) {
                memberErr = fetchedMembersError;
              } else {
                members = fetchedMembers;
              }
              console.log(`Child Contest ${contest.contest_id} Members Data:`, members); // Debug

            } else {
              console.log(`No group assignments found for child contest ${contest.contest_id}`); // Debug
              // 如果沒有隊伍對應，則設置為空，避免後續處理出錯
              teams = [];
              members = [];
            }

          } else {
            // **主賽事或獨立賽事邏輯：直接查詢**
            console.log(`Fetching data for parent/standalone contest_id: ${contest.contest_id}`); // Debug

            // 查詢隊伍資料
            const { data: fetchedTeams, error: fetchedTeamsError } = await supabase
              .from('contest_team')
              .select('contest_team_id, team_name, team_member_status')
              .eq('contest_id', contest.contest_id);
            if (fetchedTeamsError) {
              teamErr = fetchedTeamsError;
            } else {
              teams = fetchedTeams;
            }
            console.log(`Parent Contest ${contest.contest_id} Teams Data:`, teams); // Debug
            
            // 查詢成員資料
            const { data: fetchedMembers, error: fetchedMembersError } = await supabase
              .from('contest_team_member')
              .select('contest_team_id, member_id, member_name, status')
              .eq('contest_id', contest.contest_id); // 這裡之前直接用了 contest.contest_id
            if (fetchedMembersError) {
              memberErr = fetchedMembersError;
            } else {
              members = fetchedMembers;
            }
            console.log(`Parent Contest ${contest.contest_id} Members Data:`, members); // Debug
          }

          if (teamErr) {
            alert('隊伍查詢失敗: ' + teamErr.message);
            console.error('Error fetching teams:', teamErr);
            return;
          }
          if (memberErr) {
            alert('成員查詢失敗: ' + memberErr.message);
            console.error('Error fetching members:', memberErr);
            return;
          }

          // 創建隊伍映射
          const teamsMap: { [key: string]: any } = {};
          if (teams) { // 確保 teams 不為 null
            teams.forEach(t => { 
              teamsMap[t.contest_team_id] = { 
                name: t.team_name, 
                members: [],
                memberStatus: t.team_member_status
              }; 
            });
          }
          
          // 將成員分配到對應的隊伍
          if (members) { // 確保 members 不為 null
            members.forEach(m => {
              if (teamsMap[m.contest_team_id]) {
                teamsMap[m.contest_team_id].members.push(m);
              } else {
                console.warn(`Member ${m.member_name} (contest_team_id: ${m.contest_team_id}) does not have a matching team in teamsMap for contest_id ${contest.contest_id}. This might indicate data inconsistency.`);
              }
            });
          }
          console.log(`Contest ${contest.contest_id} Teams Map (after assigning members):`, teamsMap); // Debug

          // 創建模態框內容
          let msg = `<div style='max-height:70vh;overflow:auto;width:100vw;max-width:400px;padding:8px;'>`;
          msg += `<div style='font-weight:bold;margin-bottom:8px;'>【${contest.contest_name}】隊伍與成員名單</div>`;
          
          // 檢查是否有隊伍數據
          if (Object.keys(teamsMap).length === 0) {
            msg += `<div style='margin-bottom:8px;'>目前沒有隊伍資料</div>`;
          } else {
            // 遍歷所有隊伍並顯示成員
            Object.values(teamsMap).forEach((team: any) => {
              const sortedMembers = [...team.members].sort((a, b) => {
                if (a.status === 'captain') return -1;
                if (b.status === 'captain') return 1;
                return 0;
              });
              
              const statusConfirmation = team.memberStatus === 'done' 
                ? '<span style="color:#22c55e;font-weight:bold;">（隊長已確認名單）</span>' 
                : '<span style="color:#ef4444;font-weight:bold;">（名單未確認）</span>';
              
              msg += `<div style='margin-bottom:16px;border-bottom:1px solid #eee;padding-bottom:12px;'>
                <b>隊伍名稱：${team.name}</b> ${statusConfirmation}<br/>
                成員列表：`;
              
              if (sortedMembers.length === 0) {
                msg += `<div style='margin:4px 0 0 12px;color:#888;'>（尚無成員）</div>`;
              } else {
                msg += `<ul style='margin:4px 0 0 12px;padding:0;'>`;
                sortedMembers.forEach((m: any) => {
                  let statusLabel = '';
                  if (m.status === 'captain') statusLabel = '（隊長）';
                  else if (m.status === 'invited') statusLabel = '（邀請中）';
                  else if (m.status === 'pending') statusLabel = '（待回覆）';
                  else if (m.status === 'accepted') statusLabel = '（已接受）';
                  else if (m.status === 'reject') statusLabel = '（謝絕）';
                  
                  // 檢查是否為邀請中的成員且當前用戶是隊長或管理員
                  const isInvitedMember = m.status === 'invited' || m.status === 'pending';
                  const isUserCaptainOfThisTeam = team.members.some((member: any) => 
                    member.member_name === user.name && member.status === 'captain'
                  );
                  const canGenerateQR = (user.role === 'admin' || isUserCaptainOfThisTeam) && isInvitedMember;
                  
                  // 檢查是否為當前用戶自己且狀態為邀請中
                  const isCurrentUserInvited = (m.member_name === user.name || m.member_id === user.member_id) && isInvitedMember;
                  
                  if (canGenerateQR) {
                    // 找到當前隊伍的contest_team_id
                    const currentTeamId = Object.keys(teamsMap).find(key => teamsMap[key] === team) || '';
                    msg += `<li style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                      <span>${m.member_name}${statusLabel}</span>
                      <button 
                        onclick="window.generateQRForMember('${m.member_id || ''}', '${m.member_name}', ${contest.contest_id}, '${currentTeamId}')"
                        style="background: #3b82f6; color: white; border: none; padding: 2px 8px; border-radius: 4px; font-size: 12px; cursor: pointer; margin-left: 8px;"
                      >
                        生成QR碼
                      </button>
                    </li>`;
                  } else if (isCurrentUserInvited) {
                    // 當前用戶自己的邀請狀態，顯示接受按鈕
                    const currentTeamId = Object.keys(teamsMap).find(key => teamsMap[key] === team) || '';
                    msg += `<li style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                      <span>${m.member_name}${statusLabel}</span>
                      <button 
                        onclick="window.acceptInviteForMember(${contest.contest_id}, '${currentTeamId}', '${m.member_id || ''}', '${m.member_name}', '${team.name}')"
                        style="background: #22c55e; color: white; border: none; padding: 2px 8px; border-radius: 4px; font-size: 12px; cursor: pointer; margin-left: 8px;"
                      >
                        接受邀請
                      </button>
                    </li>`;
                  } else {
                    msg += `<li>${m.member_name}${statusLabel}</li>`;
                  }
                });
                msg += `</ul>`;
              }
              
              msg += `</div>`;
            });
          }
          
          msg += `</div>`;
          
          // 設置全局函數供按鈕調用
          (window as any).generateQRForMember = (memberId: string, memberName: string, contestId: number, teamId: string) => {
            generateQRInvite(memberId, memberName, contestId, teamId);
            // 關閉成員名單模態框
            const existingModal = document.querySelector('[data-member-list-modal]');
            if (existingModal) {
              document.body.removeChild(existingModal);
            }
          };
          
          // 添加接受邀請的全局函數
          (window as any).acceptInviteForMember = async (contestId: number, teamId: string, memberId: string, memberName: string, teamName: string) => {
            try {
              // 更新資料庫中的成員狀態為已接受
              const { error: updateError } = await supabase
                .from('contest_team_member')
                .update({ 
                  status: 'accepted',
                  responded_at: new Date().toISOString()
                })
                .eq('contest_team_id', teamId)
                .eq('member_id', memberId);

              if (updateError) {
                throw updateError;
              }

              // 關閉成員名單模態框
              const existingModal = document.querySelector('[data-member-list-modal]');
              if (existingModal) {
                document.body.removeChild(existingModal);
              }

              // 顯示成功訊息
              Modal.success({
                title: '加入成功！',
                content: (
                  <div>
                    <p>您已成功加入 {teamName} 隊伍參加 {contest.contest_name}</p>
                    <p style={{ marginTop: '16px', color: '#1890ff', fontWeight: 'bold' }}>
                      請登入系統後查看比賽資訊
                    </p>
                  </div>
                ),
                onOk: () => {
                  // 重新載入頁面以更新狀態
                  window.location.reload();
                }
              });

            } catch (err: any) {
              console.error('接受邀請失敗:', err);
              Modal.error({
                title: '加入失敗',
                content: '加入隊伍時發生錯誤: ' + (err.message || '未知錯誤')
              });
            }
          };
          
          const modal = document.createElement('div');
          modal.setAttribute('data-member-list-modal', 'true');
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
            // 清理全局函數
            delete (window as any).generateQRForMember;
            delete (window as any).acceptInviteForMember;
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
      {user.role === 'admin' && 
        contest.contest_status === 'recruiting' && 
        allTeamsReady[contest.contest_id] && (
        <button
          className="absolute top-4 right-44 bg-red-500 hover:bg-red-600 text-white px-4 py-1 rounded text-sm shadow ml-2"
          onClick={() => handleGenerateSchedule(contest.contest_id)}
          disabled={generatingSchedule && generatingContestId === contest.contest_id}
        >
          {generatingSchedule && generatingContestId === contest.contest_id 
            ? '產生中...' 
            : '產生對戰表'}
        </button>
      )}
      {/* Updated Battle Room / Join / Results button logic */}
      <button
        className={`absolute top-4 right-4 ${
          contest.contest_status === 'finished' 
            ? 'bg-purple-600 hover:bg-purple-700' 
            : 'bg-green-600 hover:bg-green-700'
        } text-white px-4 py-1 rounded text-sm shadow`}
        onClick={() => {
          // 檢查是否為主賽事（有子賽事的賽事）
          const hasChildren = finalSortedContests.some(item => 
            item.type === 'parent' && item.contest.contest_id === contest.contest_id && item.children.length > 0
          );
          
          let targetUrl;
          if (contest.contest_status === 'finished') {
            targetUrl = `/contest/${contest.contest_id}/results`;
          } else if (contest.contest_status === 'ongoing' || contest.contest_status === 'lineup_arrangement') {
            // 如果是主賽事且有子賽事，跳轉到結果頁面查看整體進度
            // 如果是子賽事或沒有子賽事的獨立賽事，跳轉到戰況室
            targetUrl = hasChildren 
              ? `/contest/${contest.contest_id}/results`
              : `/contest/${contest.contest_id}/battleroom`;
          } else {
            targetUrl = `/contest/${contest.contest_id}/join`;
          }
          navigate(targetUrl);
        }}
      >
        {(() => {
          // 檢查是否為主賽事（有子賽事的賽事）
          const hasChildren = finalSortedContests.some(item => 
            item.type === 'parent' && item.contest.contest_id === contest.contest_id && item.children.length > 0
          );
          
          if (contest.contest_status === 'finished') {
            return '比賽結果';
          } else if (contest.contest_status === 'ongoing' || contest.contest_status === 'lineup_arrangement') {
            // 如果是主賽事且有子賽事，顯示"賽況總覽"
            // 如果是子賽事或沒有子賽事的獨立賽事，顯示"戰況室"
            return hasChildren ? '賽況總覽' : '戰況室';
          } else {
            return '參賽';
          }
        })()}
      </button>
      <div className="mb-2">
        <div className="font-bold text-lg">
          {contest.contest_name}
          {/* 為正在進行的比賽添加閃爍效果 */}
          {contest.contest_status === 'ongoing' && (
            <span className="ml-2 inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
          )}
        </div>
        <div className="mt-1">
          {contest.contest_status === 'recruiting' && allTeamsReady[contest.contest_id] ? (
            <span className="px-2 py-0.5 rounded text-white text-xs bg-green-600">
              人員已到位
            </span>
          ) : (
            <span className={`px-2 py-0.5 rounded text-white text-xs ${STATUS_MAP[contest.contest_status]?.color || 'bg-gray-400'}`}>
              {STATUS_MAP[contest.contest_status]?.label || contest.contest_status}
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-4">
        <div>球場：{contest.team_name}</div>
        <div>建立者：{contest.created_by}</div>
        <div>報名截止日：{contest.signup_end_date}</div>
        <div>預計隊伍數：{contest.expected_teams}</div>
      </div>
      
      {teamCounts.filter(tc => tc.contest_id === contest.contest_id).length > 0 && (
        <div className="mt-3 border-t pt-2">
          <div className="text-gray-600 mb-1">預計每隊人數：{contest.players_per_team} 人</div>
          <div className="grid grid-cols-2 gap-x-2">
            {teamCounts.filter(tc => tc.contest_id === contest.contest_id).map(team => {
              const teamStatus = teamStatuses.find(ts => ts.contest_team_id === team.contest_team_id);
              const isConfirmed = teamStatus?.team_member_status === 'done';
              
              return (
                <div key={team.contest_team_id} className="text-sm">
                  <span className="font-medium">{team.team_name}：</span>
                  <span>{team.member_count} 人</span>
                  {team.member_count === parseInt(contest.players_per_team) && (
                    <span className="ml-1 text-green-600">✓</span>
                  )}
                  {isConfirmed && (
                    <span className="ml-1 text-blue-600 text-xs">[已確認]</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      
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
  );

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
          {/* Display active contests */}
          {activeContests.map(item => {
            if (item.type === 'parent') {
              const isCollapsed = collapsedParentContests[item.contest.contest_id];
              return (
                <React.Fragment key={item.contest.contest_id}>
                  {renderContestCard(item.contest)}
                  {item.children.length > 0 && (
                    <li className="mb-4 ml-4">
                      <button
                        className="w-full p-3 bg-indigo-100 hover:bg-indigo-200 rounded flex items-center justify-between text-indigo-700 font-medium transition-colors"
                        onClick={() => toggleCollapse(item.contest.contest_id)}
                      >
                        <div className="flex items-center">
                          <span className="mr-2">📁</span>
                          <span>子賽事 ({item.children.length} 場)</span>
                        </div>
                        <span className={`transform transition-transform ${isCollapsed ? 'rotate-180' : 'rotate-0'}`}>
                          ▼
                        </span>
                      </button>
                      {isCollapsed && (
                        <div className="border-l-2 border-indigo-300 pl-4 ml-2 mt-2">
                          {item.children.map(child => renderContestCard(child, true))}
                        </div>
                      )}
                    </li>
                  )}
                </React.Fragment>
              );
            } else {
              return renderContestCard(item as Contest); // Cast to Contest as it's not a parent type
            }
          })}
          
          {/* Collapsible finished contests section */}
          {finishedContests.length > 0 && (
            <>
              <li className="mb-4">
                <button
                  className="w-full p-3 bg-gray-200 hover:bg-gray-300 rounded flex items-center justify-between text-gray-700 font-medium transition-colors"
                  onClick={() => setShowFinishedContests(!showFinishedContests)}
                >
                  <div className="flex items-center">
                    <span className="mr-2">📋</span>
                    <span>已結束的比賽 ({finishedContests.length} 場)</span>
                  </div>
                  <span className={`transform transition-transform ${showFinishedContests ? 'rotate-180' : 'rotate-0'}`}>
                    ▼
                  </span>

                </button>
              </li>
              
              {/* Collapsible content */}
              {showFinishedContests && (
                <div className="border-l-2 border-gray-300 pl-4 ml-2 mb-4">
                  {finishedContests.map(item => {
                    if (item.type === 'parent') {
                      const isCollapsed = collapsedParentContests[item.contest.contest_id];
                      return (
                        <React.Fragment key={item.contest.contest_id}>
                          {renderContestCard(item.contest)}
                          {item.children.length > 0 && (
                            <li className="mb-4 ml-4">
                              <button
                                className="w-full p-3 bg-indigo-100 hover:bg-indigo-200 rounded flex items-center justify-between text-indigo-700 font-medium transition-colors"
                                onClick={() => toggleCollapse(item.contest.contest_id)}
                              >
                                <div className="flex items-center">
                                  <span className="mr-2">📁</span>
                                  <span>子賽事 ({item.children.length} 場)</span>
                                </div>
                                <span className={`transform transition-transform ${isCollapsed ? 'rotate-180' : 'rotate-0'}`}>
                                  ▼
                                </span>
                              </button>
                              {isCollapsed && (
                                <div className="border-l-2 border-indigo-300 pl-4 ml-2 mt-2">
                                  {item.children.map(child => renderContestCard(child, true))}
                                </div>
                              )}
                            </li>
                          )}
                        </React.Fragment>
                      );
                    } else {
                      return renderContestCard(item as Contest); // Cast to Contest as it's not a parent type
                    }
                  })}
                </div>
              )}
            </>
          )}
        </ul>
      </div>
      
      {/* QR碼邀請 Modal */}
      <Modal
        title="邀請QR碼"
        open={qrCodeModalOpen}
        onCancel={() => setQrCodeModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setQrCodeModalOpen(false)}>
            關閉
          </Button>
        ]}
        width={400}
        centered
      >
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <p style={{ marginBottom: '20px' }}>
            請讓隊員 <strong style={{ color: '#1890ff' }}>{currentInviteMemberName}</strong> 掃描此QR碼加入隊伍
          </p>
          {qrCodeData && (
            <img 
              src={qrCodeData} 
              alt="邀請QR碼" 
              style={{ maxWidth: '100%', height: 'auto' }}
            />
          )}
          <p style={{ marginTop: '20px', fontSize: '12px', color: '#666' }}>
            隊員掃碼後將直接跳轉到加入頁面
          </p>
        </div>
      </Modal>
    </div>
  );
};

export default ContestListPage;