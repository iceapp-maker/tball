import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate, useLocation } from 'react-router-dom';

const CreateContestPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [contestName, setContestName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [signupEndDate, setSignupEndDate] = useState(getDefaultSignupEndDate());
  const [expectedTeams, setExpectedTeams] = useState(0);
  const [playersPerTeam, setPlayersPerTeam] = useState(0);
  const [userTeamName, setUserTeamName] = useState('');
  // 新增總點數和賽制設定
  const [totalPoints, setTotalPoints] = useState(5);
  const [pointsConfig, setPointsConfig] = useState<{ type: string; note: string }[]>(
    Array(5).fill(null).map(() => ({ type: '雙打', note: '' }))
  );
  // 新增賽制選擇狀態
  const [matchMode, setMatchMode] = useState<string>('round_robin');
  // 新增球桌數設置
  const [tableCount, setTableCount] = useState<number>(1);
  // 新增比賽類型狀態
  const [contestType, setContestType] = useState('single'); // 'single' 或 'league_parent'
  const [groupCount, setGroupCount] = useState(4);
  const [advancementCount, setAdvancementCount] = useState(2);
  const [awardCount, setAwardCount] = useState(4);
  const [parentContestId, setParentContestId] = useState<string | null>(null);
  const [parentContest, setParentContest] = useState<any | null>(null);

  // 假設有user context
  const user = JSON.parse(localStorage.getItem('loginUser') || '{}');

  // 預設比賽規則內容
  const defaultRuleText = `參賽對象: 不限\n賽制: 5點雙打`;

  // 將 ruleText, setRuleText 的 useState 宣告移到這裡，只保留一份
  const [ruleText, setRuleText] = useState(defaultRuleText);

  // 當總點數變更時，更新 pointsConfig 陣列
  useEffect(() => {
    // 保留現有設定，只增減陣列長度
    const newConfig = [...pointsConfig];
    if (newConfig.length < totalPoints) {
      // 需要增加項目
      while (newConfig.length < totalPoints) {
        newConfig.push({ type: '雙打', note: '' });
      }
    } else if (newConfig.length > totalPoints) {
      // 需要減少項目
      newConfig.splice(totalPoints);
    }
    setPointsConfig(newConfig);
  }, [totalPoints]);

  useEffect(() => {
    const fetchParentData = async (parentId: string) => {
      setLoading(true);
      try {
        const { data: parentData, error: parentError } = await supabase
          .from('contest')
          .select('*')
          .eq('contest_id', parentId)
          .single();
        if (parentError) throw parentError;
        setParentContest(parentData);

        const { data: childGroups, error: childError } = await supabase
          .from('contest')
          .select('contest_id')
          .eq('parent_contest_id', parentId)
          .eq('contest_type', 'group_stage');
        if (childError) throw childError;

        // 預填寫表單
        const nextGroupLetter = String.fromCharCode(65 + (childGroups?.length || 0));
        setContestName(`${parentData.contest_name} - ${nextGroupLetter}組`);
        setTeamName(parentData.team_name);
        setRuleText(parentData.rule_text);
        setPlayersPerTeam(parentData.players_per_team);
        setTotalPoints(parentData.total_points);
        setPointsConfig(parentData.points_config);
        setMatchMode('round_robin');

      } catch (err: any) {
        console.error('獲取父賽事資訊失敗:', err);
        setErrorMsg('無法載入父賽事資訊，請返回儀表板重試。');
      } finally {
        setLoading(false);
      }
    };

    const params = new URLSearchParams(location.search);
    const parentId = params.get('parentContestId');
    if (parentId) {
      setParentContestId(parentId);
      setContestType('group_stage'); // 標記為正在建立分組賽
      fetchParentData(parentId);
    }
  }, [location.search]);

  // 當比賽類型改變時，重置相關設定
  useEffect(() => {
    if (contestType === 'league_parent') {
      // 如果是多組競賽，強制預賽為循環賽
      setMatchMode('round_robin');
    }
  }, [contestType]);

  // 根據登入者的team_id自動設定球場名稱
  useEffect(() => {
    const fetchTeamName = async () => {
      if (user?.team_id) {
        const { data, error } = await supabase
          .from('courts')
          .select('name')
          .eq('team_id', user.team_id)
          .maybeSingle();
        
        if (error) {
          console.error('無法取得球場資料:', error);
          setErrorMsg('無法取得球場資料');
          return;
        }
        
        if (data) {
          setUserTeamName(data.name);
          setTeamName(data.name); // 自動設定球場名稱
        } else {
          setErrorMsg('找不到對應的球場資料');
        }
      }
    };
    fetchTeamName();
  }, [user?.team_id]);

  // 預設報名結束日為今天+10天
  function getDefaultSignupEndDate() {
    const d = new Date();
    d.setDate(d.getDate() + 10);
    return d.toISOString().slice(0, 10);
  }

  // 更新點數設定的函數
  const updatePointConfig = (index: number, field: 'type' | 'note', value: string) => {
    const newConfig = [...pointsConfig];
    newConfig[index] = { ...newConfig[index], [field]: value };
    setPointsConfig(newConfig);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setSuccess(false);
    
    try {
      const insertData: any = {
        contest_name: contestName,
        created_by: user.name,
        team_name: teamName,
        rule_text: ruleText,
        signup_end_date: signupEndDate,
        expected_teams: Number(expectedTeams),
        players_per_team: Number(playersPerTeam),
        contest_status: 'recruiting',
        total_points: Number(totalPoints),
        points_config: pointsConfig,
        match_mode: contestType === 'league_parent' ? 'mixed_tournament' : matchMode,
        table_count: Number(tableCount),
        created_at: new Date().toISOString(),
        contest_type: contestType, // 新增欄位
      };

      if (contestType === 'league_parent') {
        insertData.advancement_rules = {
          award_count: awardCount,
          tournament_structure: []
        };
        insertData.bracket_structure = {
          pending_teams: [], // 初始為空，報名後會填入
          tournament_structure: [],
          award_count: awardCount,
          stage_info: {
            current_stage: 0,
            total_stages: 0
          }
        };
        insertData.stage_order = 0; // 主賽事為0
      }

      if (parentContestId) {
        insertData.parent_contest_id = parentContestId;
        insertData.contest_type = 'group_stage';
      }

      const { data, error } = await supabase.from('contest').insert(insertData).select();
      
      if (error) {
        throw error;
      }
      
      console.log('Contest created successfully:', data);
      setSuccess(true);
      
      // 根據比賽類型跳轉到不同頁面
      setTimeout(() => {
        if (contestType === 'league_parent') {
          // 混合賽跳轉到混合賽管理頁面
          navigate(`/contest/${data[0].contest_id}/custom`);
        } else {
          // 單一賽事跳轉到控制台
          navigate('/contest-control');
        }
      }, 1500); // 1.5秒後跳轉
      
      setContestName('');
      // 不重置 teamName，保持顯示用戶的球場
      setRuleText(defaultRuleText);
      setSignupEndDate(getDefaultSignupEndDate());
      setExpectedTeams(0);
      setPlayersPerTeam(0);
      // 重置總點數和賽制設定
      setTotalPoints(5);
      setPointsConfig(Array(5).fill(null).map(() => ({ type: '雙打', note: '' })));
      // 重置賽制選擇
      setMatchMode('round_robin');
      // 重置球桌數
      setTableCount(1);
      // 重置多組競賽設定
      setContestType('single');
      setGroupCount(4);
      setAdvancementCount(2);
      
    } catch (err: any) {
      console.error('Database error:', err);
      if (err.message.includes('duplicate key')) {
        setErrorMsg('系統錯誤：資料重複，請稍後再試或聯絡管理員');
      } else if (err.message.includes('invalid input syntax')) {
        setErrorMsg(`資料格式錯誤：${err.message}`);
      } else {
        setErrorMsg(`建立失敗：${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto mt-8 p-6 bg-white rounded shadow">
      {/* 登入者資訊顯示區塊 */}
      <div className="mb-6 p-3 bg-gray-50 border border-gray-200 rounded">
        <div className="font-medium mb-1">登入者資訊</div>
        <div className="text-sm text-gray-700">
          <span>姓名：{user?.name || '未知'}</span><br />
          <span>團隊：{userTeamName}隊</span>
        </div>
      </div>

      {parentContest && (
        <div className="mb-6 p-4 bg-blue-50 border-l-4 border-blue-500 rounded">
          <p className="font-bold text-blue-800">
            正在為「{parentContest.contest_name}」建立新分組
          </p>
          <p className="text-sm text-blue-700 mt-1">部分設定已從父賽事繼承，不可修改。</p>
        </div>
      )}

      <h2 className="text-2xl font-bold mb-4">
        {parentContest ? '建立分組賽' : '建立比賽'}
      </h2>
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="block font-medium mb-1">比賽名稱</label>
          <input
            type="text"
            className="w-full border rounded px-3 py-2"
            value={contestName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setContestName(e.target.value)}
            required
          />
        </div>
        
        <div className="mb-4">
          <label className="block font-medium mb-1">球場名稱</label>
          <div className="w-full border rounded px-3 py-2 bg-gray-100 text-gray-700">
            {teamName || '載入中...'}
          </div>
          <p className="text-sm text-gray-500 mt-1">根據您的團隊自動設定</p>
        </div>
        
        {!parentContestId && (
          <div className="mb-4">
            <label className="block font-medium mb-1">比賽類型</label>
            <select
              className="w-full border rounded px-3 py-2"
              value={contestType}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setContestType(e.target.value)}
            >
              <option value="single">單一賽事 (標準循環賽或淘汰賽)</option>
              <option value="league_parent">混合賽 (多階段自訂賽制)</option>
            </select>
            <div className="mt-2 text-sm text-gray-600">
              <p><strong>單一賽事：</strong>傳統的循環賽或淘汰賽，適合簡單的比賽形式</p>
              <p><strong>混合賽：</strong>可自由組合多個階段的賽制，如預賽(循環賽) + 決賽(淘汰賽)</p>
            </div>
          </div>
        )}
      
        {contestType === 'league_parent' && !parentContestId && (
          <div className="p-4 border-l-4 border-blue-500 bg-blue-50 mb-4 rounded">
            <h3 className="font-bold text-lg mb-2 text-blue-800">混合賽設定</h3>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <h4 className="font-medium text-blue-800 mb-2">混合賽說明</h4>
              <div className="text-sm text-blue-700 space-y-1">
                <p>• 混合賽支援多階段自訂賽制組合</p>
                <p>• 創建後將進入混合賽管理頁面</p>
                <p>• 可在管理頁面中創建各個階段的子賽事</p>
                <p>• 每個階段可選擇循環賽或淘汰賽</p>
              </div>
            </div>
            

            <div className="mb-4">
              <label className="block font-medium mb-1">預計獲獎隊伍數</label>
              <input
                type="number"
                min="1"
                max="8"
                className="w-full border rounded px-3 py-2"
                value={awardCount}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAwardCount(Number(e.target.value))}
                required
              />
              <p className="text-sm text-gray-500 mt-1">設定最終要產生多少名次的獲獎隊伍</p>
            </div>
          </div>
        )}
        
        <div className="mb-4">
          <label className="block font-medium mb-1">比賽規則</label>
          <textarea
            className="w-full border rounded px-3 py-2 min-h-[80px]"
            value={ruleText}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRuleText(e.target.value)}
            required
          />
        </div>
        <div className="mb-4">
          <label className="block font-medium mb-1">報名結束日</label>
          <input
            type="date"
            className="w-full border rounded px-3 py-2"
            value={signupEndDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSignupEndDate(e.target.value)}
            required
          />
        </div>
        <div className="mb-4">
          <label className="block font-medium mb-1">預計隊數</label>
          <input
            type="number"
            min="1"
            className="w-full border rounded px-3 py-2"
            value={expectedTeams}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExpectedTeams(Number(e.target.value))}
            required
          />
        </div>
        <div className="mb-4">
          <label className="block font-medium mb-1">每隊人數</label>
          <input
            type="number"
            min="1"
            className="w-full border rounded px-3 py-2"
            value={playersPerTeam}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPlayersPerTeam(Number(e.target.value))}
            required
          />
        </div>
        
        {contestType !== 'league_parent' && (
          <div className="mb-4">
            <label className="block font-medium mb-1">賽制類型</label>
            <div className="flex flex-col gap-3">
              <label className="inline-flex items-center">
                <input
                  type="radio"
                  className="form-radio h-5 w-5 text-blue-600"
                  name="matchMode"
                  value="round_robin"
                  checked={matchMode === 'round_robin'}
                  onChange={() => setMatchMode('round_robin')}
                />
                <span className="ml-2">循環賽</span>
                <span className="ml-1 text-xs text-gray-500">(每隊都與其他隊伍對戰)</span>
              </label>
              <label className="inline-flex items-center">
                <input
                  type="radio"
                  className="form-radio h-5 w-5 text-blue-600"
                  name="matchMode"
                  value="elimination"
                  checked={matchMode === 'elimination'}
                  onChange={() => setMatchMode('elimination')}
                />
                <span className="ml-2">淘汰賽</span>
                <span className="ml-1 text-xs text-gray-500">(輸了就淘汰)</span>
              </label>
            </div>
          </div>
        )}

        <div className="mb-4">
          <label className="block font-medium mb-1">球桌數</label>
          <input
            type="number"
            min="1"
            className="w-full border rounded px-3 py-2"
            value={tableCount}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTableCount(Number(e.target.value))}
            required
          />
        </div>

        <div className="mb-4">
          <label className="block font-medium mb-1">總點數 (共幾場)</label>
          <input
            type="number"
            min="1"
            max="10"
            className="w-full border rounded px-3 py-2"
            value={totalPoints}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTotalPoints(Number(e.target.value))}
            required
          />
        </div>
        
        <div className="mb-6">
          <label className="block font-medium mb-2">每點賽制設定</label>
          <div className="bg-gray-50 p-3 rounded border border-gray-200">
            {pointsConfig.map((point: { type: string; note: string }, index: number) => (
              <div key={index} className="flex items-center mb-2 pb-2 border-b border-gray-200 last:border-0 last:mb-0 last:pb-0">
                <span className="font-medium text-gray-700 w-16">第 {index + 1} 點：</span>
                <select
                  className="border rounded px-2 py-1 mr-2"
                  value={point.type}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updatePointConfig(index, 'type', e.target.value)}
                >
                  <option value="單打">單打</option>
                  <option value="雙打">雙打</option>
                </select>
                <input
                  type="text"
                  placeholder="備註（可選）"
                  className="border rounded px-2 py-1 flex-1"
                  value={point.note}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => updatePointConfig(index, 'note', e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
        
        <button
          type="submit"
          className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600 disabled:bg-blue-300"
          disabled={loading}
        >
          {loading ? '建立中...' : (parentContest ? '建立分組' : '建立比賽')}
        </button>
        
        {success && <p className="text-green-500 mt-4">比賽建立成功！正在跳轉...</p>}
        {errorMsg && <p className="text-red-500 mt-4">{errorMsg}</p>}
      </form>
    </div>
  );
};

export default CreateContestPage;
