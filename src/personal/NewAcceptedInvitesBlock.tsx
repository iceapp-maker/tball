import React, { useContext, useEffect, useState } from 'react';
import { UserContext } from '../UserContext'; // 🔥 從 personal/ 資料夾回到上層 src/
import { supabase } from '../supabaseClient'; // 🔥 從 personal/ 資料夾回到上層 src/
import { useNavigate } from 'react-router-dom';

interface ParticipantStatus {
  name: string;
  status: string;
}

interface AcceptedInvite {
  type: 'challenge' | 'contest';
  date: string;
  opponent: string;
  time_slot?: string;
  contest_name?: string;
  allAccepted?: boolean;
  participants?: ParticipantStatus[];
  expanded?: boolean;
  challengeId?: string;
  gameType?: 'single' | 'double';
  // 比賽來源相關欄位
  matchDetailId?: string;
  contestId?: string;
  fromContest?: string;
}

interface Member {
  id: string;
  name: string;
  team_id: string;
}

const isExpired = (date: string) => {
  if (!date) return false;
  const recordDate = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return recordDate < today;
};

const formatMD = (dateStr: string) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

const NewAcceptedInvitesBlock: React.FC = () => {
  const { user } = useContext(UserContext) ?? { user: null };
  const [accepted, setAccepted] = useState<AcceptedInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const navigate = useNavigate();

  // 🔥 參考 ChallengeListPage 的比賽名稱映射
  const [contestNames, setContestNames] = useState<Record<number, string>>({});
  const [matchDetailToContestMap, setMatchDetailToContestMap] = useState<Record<number, number>>({});

  const toggleExpand = (id: string) => {
    setAccepted((prev: AcceptedInvite[]) => 
      prev.map((item: AcceptedInvite) => 
        item.challengeId === id ? {...item, expanded: !item.expanded} : item
      )
    );
  };

  useEffect(() => {
    const fetchMembers = async () => {
      if (!user?.team_id) return;
      const { data, error } = await supabase
        .from('members')
        .select('id, name, team_id')
        .eq('team_id', user.team_id);
      
      if (!error && data) {
        setMembers(data);
      }
    };

    if (user?.team_id) {
      fetchMembers();
    }
  }, [user?.team_id]);

  // 🔥 參考 ChallengeListPage 的比賽名稱查詢邏輯
  useEffect(() => {
    async function fetchContestNames() {
      if (!user) return;
      console.log('開始查詢比賽資料...');
      
      // 1. 直接從 challenge_status_logs 表查詢所有非空的 match_detail_id
      const { data: statusLogs, error: logsError } = await supabase
        .from('challenge_status_logs')
        .select('match_detail_id')
        .not('match_detail_id', 'is', null);
      
      console.log('從 challenge_status_logs 表查詢到的資料:', statusLogs);
      
      if (!statusLogs || statusLogs.length === 0) {
        console.log('沒有找到任何帶有 match_detail_id 的記錄');
        return;
      }
      
      // 2. 提取所有不為空的 match_detail_id
      const matchDetailIds = statusLogs
        .map((log: any) => {
          const mdId = log.match_detail_id;
          return mdId ? Number(mdId) : null;
        })
        .filter(Boolean) as number[];
      
      console.log('提取的 match_detail_id 列表:', matchDetailIds);
      
      if (matchDetailIds.length === 0) {
        console.log('所有 match_detail_id 都是無效的');
        return;
      }
      
      // 3. 使用 match_detail_id 查詢 contest_match_detail 表獲取 contest_id
      const { data: matchDetails, error: matchDetailError } = await supabase
        .from('contest_match_detail')
        .select('match_detail_id, contest_id')
        .in('match_detail_id', matchDetailIds);
      
      console.log('從 contest_match_detail 表查詢到的資料:', matchDetails);
      
      if (!matchDetails || matchDetails.length === 0) {
        console.log('沒有在 contest_match_detail 表中找到記錄');
        return;
      }
      
      // 4. 建立 match_detail_id 到 contest_id 的映射
      const mdToContestIdMap: Record<number, number> = {};
      matchDetails.forEach((detail: any) => {
        if (detail.match_detail_id && detail.contest_id) {
          mdToContestIdMap[detail.match_detail_id] = detail.contest_id;
        }
      });
      
      // 5. 查詢比賽名稱 - 🔥 加入團隊篩選
      const { data: contests, error: contestsError } = await supabase
        .from('contest')
        .select('contest_id, contest_name, team_name')
        .in('contest_id', Object.values(mdToContestIdMap))
        .eq('team_name', user.team_name); // 🔥 只取得當前團隊主辦的比賽
      
      if (contestsError) {
        console.error('查詢比賽錯誤:', contestsError);
        return;
      }
      
      console.log('🔥 篩選後的比賽資料（只包含當前團隊）:', contests);
      
      // 6. 建立最終的名稱映射
      const nameMap: Record<number, string> = {};
      const idMap: Record<number, number> = {};
      
      for (const mdId of matchDetailIds) {
        const contestId = mdToContestIdMap[mdId];
        if (contestId) {
          const contest = contests.find((c: any) => c.contest_id === contestId);
          if (contest) {
            nameMap[mdId] = contest.contest_name;
            idMap[mdId] = contestId;
            console.log(`建立映射: match_detail_id ${mdId} -> contest_id ${contestId} -> name ${contest.contest_name}`);
          }
        }
      }
      
      console.log('最終的名稱映射（已篩選團隊）:', nameMap);
      console.log('最終的 ID 映射（已篩選團隊）:', idMap);
      
      setContestNames(nameMap);
      setMatchDetailToContestMap(idMap);
    }
    
    fetchContestNames();
  }, [user]);

  useEffect(() => {
    const fetchAccepted = async () => {
      setLoading(true);
      if (!user?.member_id || !user?.name || !user?.team_id) {
        setAccepted([]);
        setLoading(false);
        return;
      }
      
      // 🔥 新增：先取得同團隊的所有成員名單
      const { data: teamMembers, error: membersError } = await supabase
        .from('members')
        .select('name')
        .eq('team_id', user.team_id);
      
      if (membersError) {
        console.error('查詢團隊成員失敗:', membersError);
        setAccepted([]);
        setLoading(false);
        return;
      }
      
      const teamMemberNames = teamMembers?.map(m => m.name) || [];
      console.log('🔥 當前團隊成員名單:', teamMemberNames);
      
      // 🔥 修正：根據實際欄位查詢挑戰，包含 match_detail_id，並加入團隊篩選
      const { data: chData } = await supabase
        .from('challenges')
        .select('challenge_id, challenge_date, player1, player2, player3, player4, game_type, time_slot, status_code, match_detail_id')
        .or([
          `player1.eq.${user.name}`,
          `player2.eq.${user.name}`,
          `player3.eq.${user.name}`,
          `player4.eq.${user.name}`
        ].join(","));
        
      console.log('🔍 原始挑戰資料:', chData);
      
      // 🔥 篩選：只保留所有參與者都是同團隊成員的挑戰
      const filteredChData = chData?.filter((ch: any) => {
        const participants = [ch.player1, ch.player2, ch.player3, ch.player4].filter(Boolean);
        const allInSameTeam = participants.every(name => teamMemberNames.includes(name));
        console.log(`🔍 挑戰 ${ch.challenge_id} 參與者: [${participants.join(', ')}], 全部同團隊: ${allInSameTeam}`);
        return allInSameTeam;
      }) || [];
      
      console.log('🔥 篩選後的挑戰資料（只包含同團隊）:', filteredChData);
        
      let acceptedChs: AcceptedInvite[] = [];
      if (filteredChData && filteredChData.length > 0) {
        // 查詢 status_log
        const statusCodes = filteredChData.map((c: any) => c.status_code).filter(Boolean);
        let logsMap: Record<string, any> = {};
        if (statusCodes.length > 0) {
          const { data: logs } = await supabase
            .from('challenge_status_logs')
            .select('*')
            .in('status_code', statusCodes);
          if (logs) {
            logsMap = logs.reduce((acc: any, log: any) => {
              acc[log.status_code] = log;
              return acc;
            }, {} as Record<string, any>);
          }
        }
        
        acceptedChs = filteredChData.filter((ch: any) => {
          let playerField = '';
          if (user.name === ch.player1) playerField = 'player1_status';
          else if (user.name === ch.player2) playerField = 'player2_status';
          else if (user.name === ch.player3) playerField = 'player3_status';
          else if (user.name === ch.player4) playerField = 'player4_status';
          else return false;
          const status = logsMap[ch.status_code]?.[playerField];
          return status === '已接受' && !isExpired(ch.challenge_date);
        }).map((ch: any) => {
          const log = logsMap[ch.status_code];
          let allAccepted = false;
          let participants: ParticipantStatus[] = [];
          
          if (log) {
            if (ch.game_type === 'single') {
              allAccepted = log.player1_status === '已接受' && log.player2_status === '已接受';
              
              participants = [
                { name: ch.player1, status: log.player1_status || '未回應' },
                { name: ch.player2, status: log.player2_status || '未回應' }
              ];
            } else {
              allAccepted = log.player1_status === '已接受' && 
                            log.player2_status === '已接受' && 
                            log.player3_status === '已接受' && 
                            log.player4_status === '已接受';
              
              participants = [
                { name: ch.player1, status: log.player1_status || '未回應' },
                { name: ch.player2, status: log.player2_status || '未回應' },
                { name: ch.player3, status: log.player3_status || '未回應' },
                { name: ch.player4, status: log.player4_status || '未回應' }
              ];
            }
          }
          
          // 🔥 使用從 contestNames 映射取得的比賽名稱（已經過團隊篩選）
          const contestInfo = ch.match_detail_id ? {
            match_detail_id: ch.match_detail_id,
            contest_id: matchDetailToContestMap[ch.match_detail_id] || null,
            contest_name: contestNames[ch.match_detail_id] || null
          } : null;
          
          console.log(`🔍 挑戰 ${ch.challenge_id} (match_detail_id: ${ch.match_detail_id}) 的比賽資訊:`, contestInfo);
          
          let opponentText = [ch.player1, ch.player2, ch.player3, ch.player4]
            .filter((n: any) => n && n !== user.name)
            .join('、');
          
          // 如果有比賽資訊，只顯示比賽名稱
          if (contestInfo?.contest_name) {
            opponentText = contestInfo.contest_name; // 🔥 直接使用比賽名稱取代對手資訊
            console.log(`✅ 挑戰 ${ch.challenge_id} 顯示比賽名稱: ${contestInfo.contest_name}`);
          } else {
            console.log(`ℹ️ 挑戰 ${ch.challenge_id} 沒有比賽資訊 (match_detail_id: ${ch.match_detail_id})`);
          }
          
          const result = {
            type: 'challenge',
            date: ch.challenge_date ? ch.challenge_date.split('T')[0] : '',
            opponent: opponentText,
            time_slot: ch.time_slot,
            allAccepted,
            participants,
            expanded: false,
            challengeId: ch.challenge_id,
            gameType: ch.game_type,
            // 比賽相關資訊
            matchDetailId: contestInfo?.match_detail_id?.toString() || null,
            contestId: contestInfo?.contest_id?.toString() || null,
            fromContest: contestInfo?.contest_name || null
          };
          
          console.log(`🔍 挑戰 ${ch.challenge_id} 最終結果:`, result);
          return result;
        });
      }
      
      console.log('🔍 最終接受的挑戰列表（已篩選團隊）:', acceptedChs);
      
      // 將資料依照日期由近到遠排序（越接近今天越上面）
      const sortedAcceptedChallenges = acceptedChs.slice().sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        return dateA.getTime() - dateB.getTime();
      });

      // 🔥 查詢已接受的賽程邀約 - 加入團隊篩選
      const { data: contestData } = await supabase
        .from('contest_team_member')
        .select(`
          contest_id, 
          status, 
          contest:contest_id(
            contest_name, 
            contest_date,
            team_name
          )
        `)
        .eq('member_id', user.member_id)
        .eq('status', 'accepted');
        
      console.log('🔍 原始比賽邀約資料:', contestData);
      
      // 🔥 篩選：只保留當前團隊主辦的比賽
      const filteredContestData = contestData?.filter((ct: any) => {
        const isOwnTeamContest = ct.contest?.team_name === user.team_name;
        console.log(`🔍 比賽 ${ct.contest_id} (${ct.contest?.contest_name}) 主辦團隊: ${ct.contest?.team_name}, 當前團隊: ${user.team_name}, 符合: ${isOwnTeamContest}`);
        return isOwnTeamContest;
      }) || [];
      
      console.log('🔥 篩選後的比賽邀約資料（只包含當前團隊主辦）:', filteredContestData);
        
      let acceptedContests: AcceptedInvite[] = [];
      if (filteredContestData && filteredContestData.length > 0) {
        acceptedContests = filteredContestData
          .filter((ct: any) => !isExpired(ct.contest?.contest_date))
          .map((ct: any) => ({
            type: 'contest',
            date: '',
            opponent: '',
            contest_name: ct.contest?.contest_name || ct.contest_id,
            challengeId: `contest-${ct.contest_id}`
          }));
      }
      
      console.log('🔥 最終接受的比賽邀約列表（已篩選團隊）:', acceptedContests);
      
      setAccepted([...sortedAcceptedChallenges, ...acceptedContests]);
      setLoading(false);
    };
    fetchAccepted();
  }, [user?.member_id, user?.name, user?.team_id, user?.team_name, contestNames, matchDetailToContestMap]); // 🔥 加入團隊相關依賴

  // 根據名稱獲取成員 ID
  const getIdByName = (name: string) => {
    const member = members.find(m => m.name === name);
    return member?.id || '';
  };

  // 🔥 參考 ChallengeListPage 的 handleNavigate 邏輯
  const handleNavigate = (item: AcceptedInvite) => {
    if (item.type !== 'challenge' || !item.participants) return;
    
    const params = new URLSearchParams();
    
    // 🔥 參考 ChallengeListPage 的參數傳遞方式
    if (item.fromContest && item.matchDetailId) {
      // 如果確實有比賽資訊，設為比賽模式
      params.append('match_detail_id', item.matchDetailId);
      
      // 加入 contest_id（如果有映射）
      if (item.contestId) {
        params.append('contest_id', item.contestId);
      }
      
      // 加入比賽名稱
      params.append('contest_name', item.fromContest);
      
      // 標記為從戰況室來的
      params.append('from_battleroom', 'true');
    }
    
    if (item.gameType === 'single') {
      // 單打比賽參數
      const player1 = item.participants[0]?.name;
      const player2 = item.participants[1]?.name;
      
      if (player1) {
        const id = getIdByName(player1);
        if (id) params.append('player1', id);
      }
      
      if (player2) {
        const id = getIdByName(player2);
        if (id) params.append('player2', id);
      }
      
      navigate(`/single?${params.toString()}`);
    } else {
      // 雙打比賽參數
      const player1 = item.participants[0]?.name;
      const player2 = item.participants[1]?.name;
      const player3 = item.participants[2]?.name;
      const player4 = item.participants[3]?.name;
      
      if (player1) {
        const id = getIdByName(player1);
        if (id) params.append('player1', id);
      }
      
      if (player2) {
        const id = getIdByName(player2);
        if (id) params.append('player2', id);
      }
      
      if (player3) {
        const id = getIdByName(player3);
        if (id) params.append('player3', id);
      }
      
      if (player4) {
        const id = getIdByName(player4);
        if (id) params.append('player4', id);
      }
      
      navigate(`/double_game?${params.toString()}`);
    }
  };

  return (
    <div className="mb-6 p-4 bg-green-50 rounded shadow">
      <h3 className="font-bold mb-2 text-lg">
        我已接受的挑戰/邀約
        {user?.team_name && (
          <span className="text-sm font-normal text-gray-600 ml-2">
            （{user.team_name} 團隊）
          </span>
        )}
      </h3>
      {loading ? (
        <div>載入中...</div>
      ) : accepted.length === 0 ? (
        <div className="text-gray-500">
          無已接受的挑戰或邀約
          {user?.team_name && (
            <div className="text-xs mt-1">（只顯示 {user.team_name} 團隊相關項目）</div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="min-w-full border text-center mb-2">
            {/* 表頭 */}
            <div className="flex border-b">
              <div className="w-1/7 border-r px-2 py-1 font-bold">日期</div>
              <div className="w-1/7 border-r px-2 py-1 font-bold">類型</div>
              <div className="w-2/7 border-r px-2 py-1 font-bold">對手/比賽</div>
              <div className="w-1/7 border-r px-2 py-1 font-bold">時段</div>
              <div className="w-1/7 border-r px-2 py-1 font-bold">全部同意</div>
              <div className="w-1/7 border-r px-2 py-1 font-bold">詳情</div>
              <div className="w-1/7 px-2 py-1 font-bold">前往</div>
            </div>
            
            {/* 表格內容 */}
            <div>
              {accepted.map((item: AcceptedInvite, idx: number) => (
                <React.Fragment key={idx}>
                  <div className="flex border-b">
                    <div className="w-1/7 border-r px-2 py-1">{formatMD(item.date)}</div>
                    <div className="w-1/7 border-r px-2 py-1">
                      {item.type === 'challenge' ? 
                        (item.gameType === 'single' ? '單打' : '雙打') : 
                        '比賽'}
                    </div>
                    {/* 對手/比賽欄位：直接顯示比賽名稱或對手資訊 */}
                    <div className="w-2/7 border-r px-2 py-1 text-left">
                      <div className="truncate">
                        {item.opponent || (item.contest_name ? '賽程: ' + item.contest_name : '')}
                      </div>
                    </div>
                    <div className="w-1/7 border-r px-2 py-1">{item.time_slot || '-'}</div>
                    <div className="w-1/7 border-r px-2 py-1">
                      {item.type === 'challenge' ? 
                        (item.allAccepted ? '是' : '否') : 
                        '-'}
                    </div>
                    <div className="w-1/7 border-r px-2 py-1">
                      {item.type === 'challenge' && (
                        <button 
                          className="text-blue-500 hover:text-blue-700"
                          onClick={() => toggleExpand(item.challengeId || '')}
                        >
                          {item.expanded ? '收起' : '查看'}
                        </button>
                      )}
                    </div>
                    <div className="w-1/7 px-2 py-1">
                      {item.type === 'challenge' && (
                        <button
                          className="bg-gray-100 border border-gray-300 rounded-full px-3 py-1 hover:bg-gray-200"
                          title={`前往${item.gameType === 'single' ? '單打' : '雙打'}頁面${item.fromContest ? ' (比賽模式)' : ''}`}
                          onClick={() => handleNavigate(item)}
                        >
                          <span className="font-bold text-base">→</span>
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {/* 展開的詳細信息，加入比賽來源資訊 */}
                  {item.type === 'challenge' && item.expanded && (
                    <div className="w-full border-b px-4 py-2 bg-gray-50 text-left">
                      <div className="text-sm">
                        {/* 比賽來源資訊 */}
                        {item.fromContest && (
                          <div className="mb-3 p-2 bg-blue-50 rounded border-l-4 border-blue-400">
                            <div className="font-semibold text-blue-800 mb-1">📋 比賽資訊:</div>
                            <div className="text-blue-700">
                              比賽名稱: {item.fromContest}
                              {item.matchDetailId && (
                                <div className="text-xs text-gray-600 mt-1">
                                  比賽ID: {item.matchDetailId}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        
                        <div className="font-semibold mb-1">參與者狀態:</div>
                        <ul className="list-disc pl-5">
                          {item.participants?.map((p: ParticipantStatus, i: number) => (
                            <li key={i} className="mb-1">
                              {p.name}: <span className={p.status === '已接受' ? 'text-green-500' : 'text-orange-500'}>
                                {p.status}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NewAcceptedInvitesBlock;