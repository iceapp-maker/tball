import React, { useContext, useEffect, useState } from 'react';
import { UserContext } from '../UserContext';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom'; // 引入 useNavigate

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

// 工具函式：將日期字串轉為「月/日」格式
const formatMD = (dateStr: string) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

const NewAcceptedInvitesBlock: React.FC = () => {
  const { user } = useContext(UserContext) ?? { user: null };
  const [accepted, setAccepted] = useState<AcceptedInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]); // 新增：團隊成員列表
  const navigate = useNavigate(); // 使用 useNavigate hook

  const toggleExpand = (id: string) => {
    setAccepted((prev: AcceptedInvite[]) => 
      prev.map((item: AcceptedInvite) => 
        item.challengeId === id ? {...item, expanded: !item.expanded} : item
      )
    );
  };

  useEffect(() => {
    // 獲取成員列表
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

  useEffect(() => {
    const fetchAccepted = async () => {
      setLoading(true);
      if (!user?.member_id || !user?.name) {
        setAccepted([]);
        setLoading(false);
        return;
      }
      // 查詢已接受的挑戰
      const { data: chData } = await supabase
        .from('challenges')
        .select('challenge_id, challenge_date, player1, player2, player3, player4, game_type, time_slot, status_code')
        .or([
          `player1.eq.${user.name}`,
          `player2.eq.${user.name}`,
          `player3.eq.${user.name}`,
          `player4.eq.${user.name}`
        ].join(","));
      let acceptedChs: AcceptedInvite[] = [];
      if (chData && chData.length > 0) {
        // 查詢 status_log
        const statusCodes = chData.map((c: any) => c.status_code).filter(Boolean);
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
        acceptedChs = chData.filter((ch: any) => {
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
          
          return {
            type: 'challenge',
            date: ch.challenge_date ? ch.challenge_date.split('T')[0] : '',
            opponent: [ch.player1, ch.player2, ch.player3, ch.player4].filter((n: any) => n && n !== user.name).join('、'),
            time_slot: ch.time_slot,
            allAccepted,
            participants,
            expanded: false,
            challengeId: ch.challenge_id,
            gameType: ch.game_type
          };
        });
      }
      // 將資料依照日期由近到遠排序（越接近今天越上面）
      const sortedAcceptedChallenges = acceptedChs.slice().sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        return dateA.getTime() - dateB.getTime();
      });

      // 查詢已接受的賽程邀約
      const { data: contestData } = await supabase
        .from('contest_team_member')
        .select('contest_id, status, contest:contest_id(contest_name, contest_date)')
        .eq('member_id', user.member_id)
        .eq('status', 'accepted');
      let acceptedContests: AcceptedInvite[] = [];
      if (contestData && contestData.length > 0) {
        acceptedContests = contestData.filter((ct: any) => !isExpired(ct.contest?.contest_date)).map((ct: any) => ({
          type: 'contest',
          date: '',
          opponent: '',
          contest_name: ct.contest?.contest_name || ct.contest_id,
          challengeId: `contest-${ct.contest_id}`
        }));
      }
      setAccepted([...sortedAcceptedChallenges, ...acceptedContests]);
      setLoading(false);
    };
    fetchAccepted();
  }, [user?.member_id, user?.name]);

  // 根據名稱獲取成員 ID
  const getIdByName = (name: string) => {
    const member = members.find(m => m.name === name);
    return member?.id || '';
  };

  // 處理前往按鈕的點擊事件
  const handleNavigate = (item: AcceptedInvite) => {
    if (item.type !== 'challenge' || !item.participants) return;
    
    const params = new URLSearchParams();
    
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
      <h3 className="font-bold mb-2 text-lg">我已接受的挑戰/邀約</h3>
      {loading ? (
        <div>載入中...</div>
      ) : accepted.length === 0 ? (
        <div className="text-gray-500">無已接受的挑戰或邀約</div>
      ) : (
        <div className="space-y-2">
          <div className="min-w-full border text-center mb-2">
            {/* 表頭 */}
            <div className="flex border-b">
              <div className="w-1/7 border-r px-2 py-1 font-bold">日期</div>
              <div className="w-1/7 border-r px-2 py-1 font-bold">類型</div>
              <div className="w-1/7 border-r px-2 py-1 font-bold">對手</div>
              <div className="w-1/7 border-r px-2 py-1 font-bold">時段</div>
              <div className="w-1/7 border-r px-2 py-1 font-bold">全部同意</div>
              <div className="w-1/7 border-r px-2 py-1 font-bold">詳情</div>
              <div className="w-1/7 px-2 py-1 font-bold">前往</div> {/* 新增前往欄位 */}
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
                    <div className="w-1/7 border-r px-2 py-1 truncate">{item.opponent || (item.contest_name ? '賽程: ' + item.contest_name : '')}</div>
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
                          title={item.gameType === 'single' ? '前往單打頁面' : '前往雙打頁面'}
                          onClick={() => handleNavigate(item)}
                        >
                          <span className="font-bold text-base">→</span>
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {/* 展開的詳細信息 */}
                  {item.type === 'challenge' && item.expanded && (
                    <div className="w-full border-b px-4 py-2 bg-gray-50 text-left">
                      <div className="text-sm">
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