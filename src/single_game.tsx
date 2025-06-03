import React, { useState, useEffect, useRef, DragEvent } from 'react';
import { RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { supabase } from './supabaseClient';
import { useNavigate, useLocation } from 'react-router-dom';

interface GameScore {
  topScore: number | string;
  bottomScore: number | string;
}

interface LoginUser {
  role: string;
  name?: string;
  team_id?: string; // 確保這裡是 team_id
  [key: string]: any;
}

interface SingleGameProps {
  currentLoggedInUser: LoginUser | null;
}

function SingleGame({ currentLoggedInUser }: SingleGameProps) {
  const [topScore, setTopScore] = useState(0);
  const [bottomScore, setBottomScore] = useState(0);
  const [isTopServing, setIsTopServing] = useState(true);
  const [isVisible, setIsVisible] = useState(true);
  const [topColors, setTopColors] = useState(['red']);  
  const [bottomColors, setBottomColors] = useState(['green']);  
  const [gameOver, setGameOver] = useState(false);
  const [gameHistory, setGameHistory] = useState<GameScore[]>([]);
  const [currentGameNumber, setCurrentGameNumber] = useState(1);
  const [isFinalGame, setIsFinalGame] = useState(false);
  const [fgButtonVisible, setFgButtonVisible] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hasSaved, setHasSaved] = useState(false);
  // 新增狀態來追蹤比賽是否已完成並記錄比分
  const [isMatchCompleted, setIsMatchCompleted] = useState(false);
  
  // 新增：追蹤上下交換次數
  const [swapCount, setSwapCount] = useState(0);
  
  // Drag and drop related states
  const [showWinConfirmation, setShowWinConfirmation] = useState(false);
  const [winSide, setWinSide] = useState<'top' | 'bottom' | null>(null);
  
  // Double-click W button tracking
  const topWLastClickTime = useRef<number>(0);
  const bottomWLastClickTime = useRef<number>(0);
  const doubleClickDelay = 300; // milliseconds between clicks to count as double-click
  
  // AudioContext reference
  const audioContextRef = useRef<AudioContext | null>(null);
  
  const previousTopScoreRef = useRef(0);
  const previousBottomScoreRef = useRef(0);
  const previousTotalScoreRef = useRef(0);
  const hasReachedFiveRef = useRef(false);
  const [manualFgToggled, setManualFgToggled] = useState(false);
  
  // 會員選單狀態
  const [members, setMembers] = useState<{ id: string; name: string; team_id: string }[]>([]);
  const [redMember, setRedMember] = useState('');
  const [greenMember, setGreenMember] = useState('');
  const [redMemberName, setRedMemberName] = useState('');
  const [greenMemberName, setGreenMemberName] = useState('');

  // 積分+排名對照表狀態
  const [memberPointsMap, setMemberPointsMap] = useState<{ [memberId: string]: { points: number; rank: number|string } }>({});

  // 提交結果狀態
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [submitMessage, setSubmitMessage] = useState<string>('');
  const [showSubmitMessage, setShowSubmitMessage] = useState<boolean>(false);

  const [teamName, setTeamName] = useState('');

  // 來源標示狀態
  const [sourceType, setSourceType] = useState<'challenge' | 'battleroom'>('challenge');

  // 比賽詳情ID，用於更新比分
  const [matchDetailId, setMatchDetailId] = useState<number | null>(null);
  const [team1Name, setTeam1Name] = useState('');
  const [team2Name, setTeam2Name] = useState('');
  const [isFromBattleroom, setIsFromBattleroom] = useState(false);
  
  // 儲存比賽結果相關資訊
  const [winnerTeamId, setWinnerTeamId] = useState<string | null>(null);
  const [winnerTeamName, setWinnerTeamName] = useState<string>('');

  // 新增：遊戲統計狀態
  const [gameStatsMap, setGameStatsMap] = useState<{ [playerName: string]: number }>({});

  // 新增：追蹤自動選擇狀態
  const [autoSelectedPlayer, setAutoSelectedPlayer] = useState<'red' | 'green' | null>(null);

  // 1. 新增狀態
  const [originalPlayer1Name, setOriginalPlayer1Name] = useState<string | null>(null); // team1 對應選手
  const [originalPlayer2Name, setOriginalPlayer2Name] = useState<string | null>(null); // team2 對應選手

  const navigate = useNavigate();
  const location = useLocation();

  // 處理URL參數的統一函數
  const processUrlParameters = () => {
    const params = new URLSearchParams(location.search);
    
    // 檢查來源 - 戰況室 vs 一般挑戰
    const fromBattleroom = params.get('from_battleroom');
    const fromChallenge = params.get('player1') || params.get('player2');
    setIsFromBattleroom(fromBattleroom === 'true');
    setSourceType(fromBattleroom === 'true' ? 'contest' : 'challenge');
    
    // 如果不是從戰況室或約戰頁面進入，清除 sessionStorage 中的相關數據
    if (fromBattleroom !== 'true' && !fromChallenge) {
      console.log('直接進入單打頁面，清除 sessionStorage 中的選手數據');
      sessionStorage.removeItem('player1_member_id');
      sessionStorage.removeItem('player2_member_id');
      // 清除選手選擇
      setRedMember('');
      setGreenMember('');
      setRedMemberName('');
      setGreenMemberName('');
    }
    
    // 統一處理所有可能的參數格式
    // 1. 戰況室參數: player1_name, player2_name, player1_member_id, player2_member_id
    // 2. 約戰頁面參數: player1, player2 (ID)
    
    // 獲取名稱參數
    const p1Name = params.get('player1_name');
    const p2Name = params.get('player2_name');
    
    // 獲取會員ID參數 - 不同格式
    const p1MemberId = params.get('player1_member_id') || params.get('player1');
    const p2MemberId = params.get('player2_member_id') || params.get('player2');
    
    console.log('頁面參數解析結果:', { 
      來源: fromBattleroom === 'true' ? '戰況室' : (fromChallenge ? '約戰頁面' : '直接進入'),
      p1Name, 
      p2Name, 
      p1MemberId, 
      p2MemberId 
    });
    
    // 暫時設置名稱，稍後會在 members 載入後再次檢查
    if (p1Name) setRedMemberName(p1Name);
    if (p2Name) setGreenMemberName(p2Name);
    
    // 只有從戰況室或約戰頁面進入時才保存 ID 到 sessionStorage
    if ((fromBattleroom === 'true' || fromChallenge) && p1MemberId) {
      sessionStorage.setItem('player1_member_id', p1MemberId);
    }
    if ((fromBattleroom === 'true' || fromChallenge) && p2MemberId) {
      sessionStorage.setItem('player2_member_id', p2MemberId);
    }
    
    // 戰況室特有參數
    if (fromBattleroom === 'true') {
      const matchDetailIdParam = params.get('match_detail_id');
      if (matchDetailIdParam) {
        setMatchDetailId(parseInt(matchDetailIdParam, 10));
      }
      
      // 獲取隊伍名稱
      const team1NameParam = params.get('team1_name');
      const team2NameParam = params.get('team2_name');
      if (team1NameParam) setTeam1Name(team1NameParam);
      if (team2NameParam) setTeam2Name(team2NameParam);
      // 新增：記錄原始對應關係
      const p1Name = params.get('player1_name');
      const p2Name = params.get('player2_name');
      setOriginalPlayer1Name(p1Name || null);
      setOriginalPlayer2Name(p2Name || null);
    }
  };

  // 在組件掛載和URL變更時處理參數
  useEffect(() => {
    processUrlParameters();
  }, [location.search]);

  // 新增：排序邏輯
  const sortMembersWithGameStats = (members: any[], memberPointsMap: any, gameStatsMap: any) => {
    console.log('開始排序會員，遊戲統計（單打+雙打）:', gameStatsMap);
    console.log('會員列表:', members.map(m => ({ name: m.name, member_id: m.member_id })));
    console.log('積分資料:', memberPointsMap);
    
    return [...members].sort((a, b) => {
      // 獲取比賽次數（單打+雙打總和）
      const aGameCount = gameStatsMap[a.name] || 0;
      const bGameCount = gameStatsMap[b.name] || 0;
      const aPoints = memberPointsMap[a.id]?.points || 0;
      const bPoints = memberPointsMap[b.id]?.points || 0;
      
      console.log(`比較 ${a.name}(${aGameCount}場,${aPoints}分,${a.member_id}) vs ${b.name}(${bGameCount}場,${bPoints}分,${b.member_id})`);
      
      // 1. 比賽次數分組（有比賽 vs 無比賽）
      const aHasGames = aGameCount > 0;
      const bHasGames = bGameCount > 0;
      
      if (aHasGames !== bHasGames) {
        console.log(`  → 比賽次數分組: ${aHasGames ? a.name : b.name} 在前（有比賽記錄）`);
        return bHasGames - aHasGames; // 有比賽的在前
      }
      
      // 2. 同組內依比賽次數排序（如果都有比賽記錄）
      if (aHasGames && bHasGames && aGameCount !== bGameCount) {
        console.log(`  → 比賽次數排序: ${aGameCount > bGameCount ? a.name : b.name} 在前（比賽次數多）`);
        return bGameCount - aGameCount; // 比賽次數多的在前
      }
      
      // 3. 依積分排序（高到低）
      if (aPoints !== bPoints) {
        console.log(`  → 積分排序: ${aPoints > bPoints ? a.name : b.name} 在前（積分高）`);
        return bPoints - aPoints; // 積分高的在前
      }
      
      // 4. 依會員編號排序（小到大）
      console.log(`  → 會員編號排序: ${a.member_id < b.member_id ? a.name : b.name} 在前（編號小）`);
      return a.member_id.localeCompare(b.member_id); // 編號小的在前
    });
  };

  // 新增：除錯用函數
  const debugGameStatsConversion = (data: any) => {
    console.log('=== 除錯：檢查 RPC 返回資料轉換 ===');
    console.log('RPC 原始資料:', data);
    
    const gameStatsMap: { [key: string]: number } = {};
    data?.forEach((stat: any) => {
      console.log(`轉換: ${stat.player_name} -> ${stat.game_count} 場`);
      gameStatsMap[stat.player_name] = parseInt(stat.game_count); // 確保轉為數字
    });
    
    console.log('轉換後的 gameStatsMap:', gameStatsMap);
    return gameStatsMap;
  };

  // 新增：查詢比賽統計函數
  const fetchRecentGameStats = async (teamId: string) => {
    console.log('查詢前30天比賽統計（單打+雙打）...');
    
    try {
      // 首先嘗試使用 RPC 函數
      const { data, error } = await supabase
        .rpc('get_recent_game_stats', {
          p_team_id: teamId,
          p_days_ago: 30
        });
      
      if (error) {
        console.error('查詢比賽統計錯誤:', error);
        return {};
      }
      
      console.log('RPC 查詢到的比賽統計（單打+雙打）:', data);
      
      // 使用除錯函數轉換資料
      return debugGameStatsConversion(data);
      
    } catch (err) {
      console.error('查詢比賽統計時發生錯誤:', err);
      return {};
    }
  };

  // 新增：檢查最終排序結果
  const debugFinalSorting = (sortedMembers: any[], pointsMap: any, gameStatsMap: any) => {
    console.log('=== 除錯：最終排序結果 ===');
    sortedMembers.forEach((member, index) => {
      const gameCount = gameStatsMap[member.name] || 0;
      const points = pointsMap[member.id]?.points || 0;
      console.log(`${index + 1}. ${member.name} - ${gameCount}場比賽, ${points}分, 編號:${member.member_id}`);
    });
    
    // 驗證是否按比賽次數正確排序
    const gameCountOrder = sortedMembers.map(m => gameStatsMap[m.name] || 0);
    console.log('比賽次數順序:', gameCountOrder);
    
    let isCorrectOrder = true;
    for (let i = 0; i < gameCountOrder.length - 1; i++) {
      if (gameCountOrder[i] < gameCountOrder[i + 1]) {
        // 檢查是否是有比賽 vs 無比賽的分組
        const currentHasGames = gameCountOrder[i] > 0;
        const nextHasGames = gameCountOrder[i + 1] > 0;
        if (currentHasGames === nextHasGames) {
          console.warn(`⚠️ 排序錯誤: 位置 ${i} (${gameCountOrder[i]}場) < 位置 ${i+1} (${gameCountOrder[i+1]}場)`);
          isCorrectOrder = false;
        }
      }
    }
    
    console.log(isCorrectOrder ? '✅ 排序正確' : '❌ 排序有誤');
  };

  // 修改 fetchMembersAndPoints 函數
  useEffect(() => {
    const fetchMembersAndPoints = async () => {
      console.log('當前來源狀態:', isFromBattleroom ? '戰況室' : '一般挑戰賽');
      
      // 從URL獲取選手名稱
      const params = new URLSearchParams(location.search);
      const p1Name = params.get('player1_name');
      const p2Name = params.get('player2_name');
      
      // 從 sessionStorage 獲取 member_id
      const p1MemberId = sessionStorage.getItem('player1_member_id');
      const p2MemberId = sessionStorage.getItem('player2_member_id');
      
      console.log('選手資訊:', { p1Name, p2Name, p1MemberId, p2MemberId });
      
      // 檢查是否為直接進入（沒有URL參數）
      const isDirectEntry = !p1Name && !p2Name && !p1MemberId && !p2MemberId;
      console.log('是否為直接進入:', isDirectEntry);
      
      let allMembers: any[] = [];
      
      // 查詢符合條件的會員
      console.log('查詢符合條件的會員');
      
      let dynamicTeamId = currentLoggedInUser?.team_id ?? 'T';
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      
      // 1. 查詢所有會員
      const { data: membersData, error: membersError } = await supabase
        .from('members')
        .select('*')
        .eq('team_id', dynamicTeamId);
        
      if (membersError) {
        console.error('查詢會員錯誤:', membersError);
      } else {
        allMembers = membersData || [];
        console.log('獲取到的會員:', allMembers.length, '筆');
        
        // 2. 查詢本月有成績的會員
        const { data: summary, error: summaryError } = await supabase
          .from('member_monthly_score_summary')
          .select('*')
          .eq('team_id', dynamicTeamId)
          .eq('year', year)
          .eq('month', month);
          
        if (summaryError) {
          console.error('查詢積分錯誤:', summaryError);
        }

        // 3. 合併成績與排名
        const pointsMap: { [memberId: string]: { points: number; rank: number|string } } = {};
        
        // 從所有會員中篩選出非比賽選手的 ID
        const regularMembers = allMembers.filter((m: any) => m.team_id !== 'CONTEST');
        
        console.log('查詢積分的會員 ID:', regularMembers.map((m: any) => m.id));
        
        // 如果有積分數據，則設置積分
        if (summary) {
          summary.forEach((row: any) => {
            pointsMap[row.member_id] = { points: row.points, rank: row.rank };
          });
        }
        
        // 沒有成績的會員預設為 0 分/"-"名
        allMembers.forEach((m: any) => {
          if (!pointsMap[m.id]) {
            pointsMap[m.id] = { points: 0, rank: '-' };
          }
        });
        setMemberPointsMap(pointsMap);

        // 4. 查詢比賽統計
        const gameStats = await fetchRecentGameStats(dynamicTeamId);
        setGameStatsMap(gameStats);

        // 5. 排序會員列表
        const sortedMembers = sortMembersWithGameStats(allMembers, pointsMap, gameStats);
        debugFinalSorting(sortedMembers, pointsMap, gameStats);
        setMembers(sortedMembers);
        
        // ===== 新增：智能預選邏輯 =====
        if (isDirectEntry && currentLoggedInUser?.name && allMembers.length > 0) {
          // 尋找登入者在會員列表中的資料
          const loginUserMember = allMembers.find(m => m.name === currentLoggedInUser.name);
          
          if (loginUserMember) {
            console.log('直接進入模式，自動預選登入者:', loginUserMember.name);
            setRedMemberName(loginUserMember.name);
            setAutoSelectedPlayer('red'); // 標記為自動選擇
          } else {
            console.log('未在會員列表中找到登入者:', currentLoggedInUser.name);
          }
        } else {
          // 處理會員 ID 參數（原有邏輯）
          if (allMembers.length > 0) {
            // 嘗試不同方式匹配選手 ID
            const findPlayer = (memberId: string | null) => {
              if (!memberId) return null;
              
              // 首先嘗試匹配 member_id（戰況室格式）
              let player = allMembers.find(m => m.member_id === memberId);
              
              // 如果沒找到，嘗試匹配 id（約戰頁面格式）
              if (!player) {
                player = allMembers.find(m => m.id === memberId);
              }
              
              return player;
            };
            
            // 處理紅色選手
            if (p1MemberId) {
              console.log('嘗試使用 ID 選擇紅色選手:', p1MemberId);
              const player1 = findPlayer(p1MemberId);
              if (player1) {
                console.log('找到符合的紅色選手:', player1.name);
                setRedMember(player1.id);
                setRedMemberName(player1.name);
              } else {
                console.log('未找到符合ID的紅色選手');
              }
            }
            
            // 處理綠色選手
            if (p2MemberId) {
              console.log('嘗試使用 ID 選擇綠色選手:', p2MemberId);
              const player2 = findPlayer(p2MemberId);
              if (player2) {
                console.log('找到符合的綠色選手:', player2.name);
                setGreenMember(player2.id);
                setGreenMemberName(player2.name);
              } else {
                console.log('未找到符合ID的綠色選手');
              }
            }
          }
        }
        // ===== 智能預選邏輯結束 =====
        
        // 如果還沒有通過 ID 設置選手，嘗試通過名稱匹配（原有邏輯）
        if (!redMember || !greenMember) {
          console.log('嘗試通過名稱匹配選手');
          
          if (p1Name && !redMember) {
            const redMatch = allMembers.find(m => m.name === p1Name);
            if (redMatch) {
              console.log('匹配到紅色選手:', redMatch.name, '(ID:', redMatch.id, ')');
              setRedMember(redMatch.id);
              setRedMemberName(redMatch.name);
            } else {
              console.log('未找到匹配的紅色選手:', p1Name);
            }
          }
          
          if (p2Name && !greenMember) {
            const greenMatch = allMembers.find(m => m.name === p2Name);
            if (greenMatch) {
              console.log('匹配到綠色選手:', greenMatch.name, '(ID:', greenMatch.id, ')');
              setGreenMember(greenMatch.id);
              setGreenMemberName(greenMatch.name);
            } else {
              console.log('未找到匹配的綠色選手:', p2Name);
            }
          }
        }
        
        // 如果是從戰況室進入，檢查比賽是否已完成（原有邏輯）
        if (isFromBattleroom && matchDetailId) {
          console.log('戰況室模式，檢查比賽是否已完成，matchDetailId:', matchDetailId);
          const { data, error } = await supabase
            .from('contest_match_detail')
            .select('score')
            .eq('match_detail_id', matchDetailId)
            .not('score', 'is', null)
            .maybeSingle();
            
          if (error) {
            console.error('查詢比賽完成狀態錯誤:', error);
          } else if (data) {
            console.log('比賽已完成，比分:', data.score);
            setIsMatchCompleted(true);
          } else {
            console.log('比賽尚未完成');
            setIsMatchCompleted(false);
          }
        }
      }
    };
    fetchMembersAndPoints();
  }, [currentLoggedInUser?.team_id, isFromBattleroom, location.search, redMember, greenMember]);

  // Initialize AudioContext when first needed
  const getAudioContext = () => {
    if (!audioContextRef.current) {
      // Use standard AudioContext or webkitAudioContext for older browsers
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        audioContextRef.current = new AudioContextClass();
      }
    }
    return audioContextRef.current;
  };
  
  // Function to create beep sound with specified parameters
  const createBeepSound = (
    frequency = 700, 
    duration = 150, 
    volume = 0.5, 
    type: OscillatorType = 'sine'
  ) => {
    if (!soundEnabled) return;
    
    try {
      const audioContext = getAudioContext();
      if (!audioContext) return;
      
      // Resume audio context if it's suspended (browser requirement)
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
      
      // Create oscillator and gain nodes
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      // Configure the oscillator
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      
      // Configure volume
      gainNode.gain.value = volume;
      
      // To avoid clicks, ramp volume up and down
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(volume, audioContext.currentTime + 0.01);
      gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + duration / 1000);
      
      // Connect the nodes
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // Start and stop the oscillator
      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration / 1000);
    } catch (error) {
      console.log("Audio generation error:", error);
    }
  };
  
  // Define different sound patterns
  const playScoreSound = () => {
    createBeepSound(800, 80, 0.3, 'sine'); // 高頻短音
  };
  
  const playSwitchSound = () => {
    createBeepSound(500, 120, 0.3, 'triangle'); // 中頻中長音
  };
  
  const playGameOverSound = () => {
    // 遊戲結束音效 - 三個音的序列
    createBeepSound(600, 120, 0.3, 'triangle');
    setTimeout(() => {
      createBeepSound(700, 120, 0.3, 'triangle');
    }, 150);
    setTimeout(() => {
      createBeepSound(900, 250, 0.4, 'triangle');
    }, 300);
  };
  
  const playFGSound = () => {
    // 決勝局激活音效 - 上升的兩個音
    createBeepSound(500, 150, 0.3, 'sine');
    setTimeout(() => {
      createBeepSound(700, 250, 0.4, 'sine');
    }, 180);
  };
  
  const playWinSound = () => {
    // W獲勝音效 - 上升的三個音
    createBeepSound(500, 100, 0.3, 'sine');
    setTimeout(() => {
      createBeepSound(700, 100, 0.3, 'sine');
    }, 120);
    setTimeout(() => {
      createBeepSound(900, 200, 0.4, 'sine');
    }, 240);
  };
  
  // Cleanup audio context on component unmount
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);
  
  // 重置遊戲狀態
  const resetGameState = (preserveFG = false) => {
    setTopScore(0);
    setBottomScore(0);
    setGameOver(false);
    setIsVisible(true);
    previousTopScoreRef.current = 0;
    previousBottomScoreRef.current = 0;
    previousTotalScoreRef.current = 0;
    
    hasReachedFiveRef.current = false;

    const isOddGame = currentGameNumber % 2 === 1;
    setIsTopServing(!isOddGame);
    
    // 只有在不保留FG狀態時才設置isFinalGame
    if (!preserveFG) {
      setIsFinalGame(currentGameNumber === 5);
    }
    
    // Reset drag and drop states
    setShowWinConfirmation(false);
    setWinSide(null);
  };

  useEffect(() => {
    if (gameOver) {
      // 延遲 0.5 秒後自動開始下一局
      const timer = setTimeout(() => {
        setCurrentGameNumber((prev: number) => prev + 1);
        resetGameState();
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [gameOver]);
  
  useEffect(() => {
    const isOddGame = currentGameNumber % 2 === 1;
    setIsTopServing(!isOddGame);
    
    // Only set automatic FG if user hasn't manually toggled it
    if (!manualFgToggled) {
      const newIsFinalGame = currentGameNumber === 5;
      setIsFinalGame(newIsFinalGame);
      
      // Play sound when entering final game mode automatically
      if (newIsFinalGame && !isFinalGame) {
        playFGSound();
      }
    }
  }, [currentGameNumber, isFinalGame, manualFgToggled]);

  useEffect(() => {
    if (gameOver) return;
    
    const interval = setInterval(() => {
      setIsVisible((prev: boolean) => !prev);
    }, 500);

    return () => clearInterval(interval);
  }, [gameOver]);

  useEffect(() => {
    if (!isFinalGame) return;
    
    const interval = setInterval(() => {
      setFgButtonVisible((prev: boolean) => !prev);
    }, 500);

    return () => clearInterval(interval);
  }, [isFinalGame]);

  useEffect(() => {
    const totalScore = topScore + bottomScore;
    const prevTotalScore = previousTotalScoreRef.current;
    const isScoreChange = totalScore !== prevTotalScore;
    
    // Exit if no score change
    if (!isScoreChange) return;
    
    // Determine if it's a score increment or decrement
    const isScoreDecrement = totalScore < prevTotalScore;
    
    const scoreDiff = Math.abs(topScore - bottomScore);
    const isDeuce = topScore >= 10 && bottomScore >= 10;
    
    const currentHasReachedFive = topScore === 5 || bottomScore === 5;
    const firstTimeReachingFive = currentHasReachedFive && !hasReachedFiveRef.current;
    
    if (currentHasReachedFive) {
      hasReachedFiveRef.current = true;
      
      // Play special sound when first reaching five in final game
      if (firstTimeReachingFive && isFinalGame) {
        playFGSound();
      }
    }

    // Important: calculate if the parity changed (odd/even transition)
    const prevIsEven = prevTotalScore % 2 === 0;
    const currentIsEven = totalScore % 2 === 0;
    const parityChanged = prevIsEven !== currentIsEven;
    
    let sideChanged = false;

    // 单打模式下，只需要切换发球方，不交换颜色
    if (isScoreDecrement) {
      // 减分时，只有奇偶性改变才切换发球方
      if (parityChanged) {
        setIsTopServing((prev: boolean) => !prev);
        sideChanged = true;
      }
    } else if (isDeuce || (totalScore > 0 && totalScore % 2 === 0)) {
      // 得分时，按规则切换发球方
      setIsTopServing((prev: boolean) => !prev);
      sideChanged = true;
    }
    
    // Play switch side sound if serving side changed
    if (sideChanged) {
      playSwitchSound();
    }

    // Check win conditions
    if ((topScore >= 11 || bottomScore >= 11) && (!isDeuce || scoreDiff >= 2)) {
      setGameOver(true);
      playGameOverSound();
      if (gameHistory.length < 7) {
        setGameHistory(prev => [...prev, { topScore, bottomScore }]);
      }
    }

    // Update refs for next comparison
    previousTopScoreRef.current = topScore;
    previousBottomScoreRef.current = bottomScore;
    previousTotalScoreRef.current = totalScore;
  }, [topScore, bottomScore, isFinalGame]);

  const handleReset = () => {
    if (gameOver) {
      setCurrentGameNumber((prev: number) => prev + 1);
    } else {
      resetGameState();
    }
    setHasSaved(false);
  };

  const toggleFinalGame = () => {
    const newState = !isFinalGame;
    setIsFinalGame(newState);
    setManualFgToggled(true); // Mark that user has manually toggled FG
    
    if (newState) {
      playFGSound();
    }
  };
  
  const toggleSound = () => {
    setSoundEnabled((prev: boolean) => !prev);
    
    // Play a test sound when turning sound on
    if (!soundEnabled) {
      // Brief delay to ensure the state has updated
      setTimeout(() => {
        createBeepSound(600, 80, 0.2, 'sine');
      }, 50);
    }
  };

  // 新的重新計算函數 - 從0開始計算到目標分數，並保留FG狀態
  const recalculateScore = (targetTopScore: number, targetBottomScore: number) => {
    // 保存當前FG狀態
    const currentIsFinalGame = isFinalGame;
    
    // 重置狀態，但保留FG狀態
    resetGameState(true);
    
    // 確保FG狀態保持不變
    setIsFinalGame(currentIsFinalGame);
    
    // 延遲執行以確保狀態已重置
    setTimeout(() => {
      // 使用一個臨時函數來逐步增加分數
      const incrementScoresStep = (
        currentTop: number, 
        currentBottom: number,
        targetTop: number,
        targetBottom: number
      ) => {
        if (currentTop === targetTop && currentBottom === targetBottom) {
          return; // 已達到目標分數
        }
        
        // 決定下一步增加哪個分數
        if (currentTop < targetTop) {
          setTopScore(currentTop + 1);
          setTimeout(() => {
            incrementScoresStep(currentTop + 1, currentBottom, targetTop, targetBottom);
          }, 0);
        } else if (currentBottom < targetBottom) {
          setBottomScore(currentBottom + 1);
          setTimeout(() => {
            incrementScoresStep(currentTop, currentBottom + 1, targetTop, targetBottom);
          }, 0);
        }
      };
      
      // 開始增加分數
      incrementScoresStep(0, 0, targetTopScore, targetBottomScore);
    }, 0);
  };

  // 修改減分功能使用重新計算
  const decrementTopScore = () => {
    if (!gameOver && topScore > 0) {
      const newTopScore = topScore - 1;
      recalculateScore(newTopScore, bottomScore);
    }
  };

  const decrementBottomScore = () => {
    if (!gameOver && bottomScore > 0) {
      const newBottomScore = bottomScore - 1;
      recalculateScore(topScore, newBottomScore);
    }
  };

  // Score increment handlers
  const incrementTopScore = () => {
    if (!gameOver) {
      setTopScore(prev => prev + 1);
      playScoreSound();
    }
  };
  
  const incrementBottomScore = () => {
    if (!gameOver) {
      setBottomScore(prev => prev + 1);
      playScoreSound();
    }
  };

  // Handle double-click for W buttons
  const handleWButtonClick = (side: 'top' | 'bottom') => {
    if (gameOver) return;
    
    const now = Date.now();
    const lastClickTime = side === 'top' ? topWLastClickTime.current : bottomWLastClickTime.current;
    
    if (now - lastClickTime < doubleClickDelay) {
      // Double-click detected!
      setWinSide(side);
      setShowWinConfirmation(true);
    }
    
    // Update last click time
    if (side === 'top') {
      topWLastClickTime.current = now;
    } else {
      bottomWLastClickTime.current = now;
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('text/plain', e.currentTarget.id);
    // Set a custom dragging style
    e.currentTarget.classList.add('opacity-50');
  };
  
  const handleDragEnd = (e: DragEvent<HTMLDivElement>) => {
    // Remove custom dragging style
    e.currentTarget.classList.remove('opacity-50');
  };
  
  const handleDragOver = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.classList.add('border-white', 'border-4');
  };
  
  const handleDragLeave = (e: DragEvent<HTMLButtonElement>) => {
    e.currentTarget.classList.remove('border-white', 'border-4');
  };
  
  const handleDrop = (e: DragEvent<HTMLButtonElement>, side: 'top' | 'bottom') => {
    e.preventDefault();
    e.currentTarget.classList.remove('border-white', 'border-4');
    
    const id = e.dataTransfer.getData('text/plain');
    
    // Check if the dragged element is a W button and the game is not over yet
    if ((id === 'top-w-button' || id === 'bottom-w-button') && !gameOver) {
      setWinSide(side);
      setShowWinConfirmation(true);
    }
  };
  
  // Handle win confirmation
  const confirmWin = () => {
    if (winSide === 'top' || winSide === 'bottom') {
      playWinSound();
      
      // Add to game history with a "W" for the winner and empty for the loser
      const newGameScore: GameScore = winSide === 'top' 
        ? { topScore: "W", bottomScore: "" }
        : { topScore: "", bottomScore: "W" };
      
      setGameHistory(prev => [...prev, newGameScore]);
      
      // End the game
      setGameOver(true);
      
      // Hide the confirmation dialog
      setShowWinConfirmation(false);
    }
  };
  
  const cancelWin = () => {
    setShowWinConfirmation(false);
    setWinSide(null);
  };

  const getSquareStyle = (color: string, isCurrentSideServing: boolean) => {
    const baseColor = {
      'red': 'bg-red-600 hover:bg-red-700',
      'green': 'bg-green-600 hover:bg-green-700',
    }[color];

    return `w-1/2 aspect-square ${baseColor} transition-colors ${
      isCurrentSideServing && !isVisible ? 'opacity-50' : 'opacity-100'
    }`;
  };

  // Calculate wins for each side
  const getWins = (isTop: boolean) => {
    return gameHistory.filter(game => {
      if (typeof game.topScore === 'string' && typeof game.bottomScore === 'string') {
        return isTop ? game.topScore === 'W' : game.bottomScore === 'W';
      } else {
        return isTop 
          ? (game.topScore as number) > (game.bottomScore as number) 
          : (game.bottomScore as number) > (game.topScore as number);
      }
    }).length;
  };

  // Generate stars based on number of wins
  const renderStars = (wins: number) => {
    return Array(wins).fill('★').join(' ');
  };

  // 取得雙方勝場數（星號數）
  const redWins = getWins(true);
  const greenWins = getWins(false);
  const isSaveDisabled = redWins === 0 && greenWins === 0 || isMatchCompleted;

  // 提交比賽結果到後端
  const submitGameResult = async () => {
    // 如果已儲存過或比賽已完成，就不再重複儲存
    if (hasSaved || isMatchCompleted) {
      console.log('=== 儲存檢查 ===');
      console.log('已儲存:', hasSaved, '比賽已完成:', isMatchCompleted);
      return;
    }

    // 修改驗證條件
    if (!redMemberName || !greenMemberName) {
      console.log('=== 驗證失敗 ===');
      console.log('紅色選手:', redMemberName, '綠色選手:', greenMemberName);
      setSubmitStatus('error');
      setSubmitMessage('請選擇所有位置的會員');
      setShowSubmitMessage(true);
      setTimeout(() => setShowSubmitMessage(false), 3000);
      return;
    }

    console.log('=== 開始儲存比賽結果（基於星號數量判定） ===');
    console.log('選手配置:');
    console.log('  紅色選手 (player1):', redMemberName);
    console.log('  綠色選手 (player2):', greenMemberName);

    setSubmitStatus('loading');
    setShowSubmitMessage(true);
    setSubmitMessage('儲存中...');
    
    try {
      // 取得登入者名稱
      const loginUserName = currentLoggedInUser?.name ?? '訪客';

      // 獲取位置勝場數（星號數量）
      const topWins = getWins(true);   // 上方位置的勝場（星號數）
      const bottomWins = getWins(false); // 下方位置的勝場（星號數）
      
      console.log('=== 簡化比分計算 ===');
      console.log('當前界面顯示：');
      console.log('  上方選手:', redMemberName, '星號數:', topWins);
      console.log('  下方選手:', greenMemberName, '星號數:', bottomWins);

      // 【挑戰賽】：直接使用界面顯示的結果
      const challengePlayer1Score = topWins;    // redMemberName的得分
      const challengePlayer2Score = bottomWins; // greenMemberName的得分
      const challengeScore = `${challengePlayer1Score}:${challengePlayer2Score}`;
      console.log('=== 挑戰賽比分 ===');
      console.log(`${redMemberName}:${greenMemberName} = ${challengeScore}`);

      // 判定獲勝者（用挑戰賽格式）
      let winner = '';
      if (challengePlayer1Score > challengePlayer2Score) {
        winner = `紅色選手 ${redMemberName} 獲勝 (${challengePlayer1Score}:${challengePlayer2Score})`;
      } else if (challengePlayer2Score > challengePlayer1Score) {
        winner = `綠色選手 ${greenMemberName} 獲勝 (${challengePlayer2Score}:${challengePlayer1Score})`;
      } else {
        winner = `平局 (${challengePlayer1Score}:${challengePlayer2Score})`;
      }
      console.log('=== 獲勝判定 ===');
      console.log(winner);
      
      // 獲取會員名稱
      const redMemberObj = members.find(m => m.name === redMemberName);
      const greenMemberObj = members.find(m => m.name === greenMemberName);
      
      const redMemberNameVal = redMemberObj?.name || redMemberName || '';
      const greenMemberNameVal = greenMemberObj?.name || greenMemberName || '';
      
      // 準備要提交的資料（始終用挑戰賽格式）
      const gameData = {
        player1: redMemberNameVal,
        player2: greenMemberNameVal,
        score: challengeScore, // 【重要】始終使用挑戰賽格式記錄到 g_single_game
        created_by_name: loginUserName,
        notes: `${new Date().toISOString()} - 單打比賽 - ${winner}`,
        team_id: currentLoggedInUser?.team_id || 'T',
        source_type: sourceType,
        source_id: isFromBattleroom && matchDetailId ? matchDetailId.toString() : null,
      };
      console.log('=== 準備提交的資料（挑戰賽格式）===');
      console.log('gameData:', gameData);
      
      // Insert the game result into the g_single_game table
      const { data, error } = await supabase
        .from('g_single_game')
        .insert([gameData]);
      
      if (error) {
        console.error('儲存失敗:', error);
        setSubmitStatus('error');
        setSubmitMessage(`儲存失敗: ${error.message}`);
      } else {
        console.log('儲存成功:', data);
        setSubmitStatus('success');
        setSubmitMessage('比賽結果已成功儲存！');
        setHasSaved(true);
        
        // 【戰況室特有】更新比賽詳情時使用隊伍比分格式
        if (isFromBattleroom && matchDetailId) {
          try {
            console.log('=== 🎯 戰況室模式：更新比賽詳情開始 ===');
            console.log('📋 基本參數:', {
              isFromBattleroom,
              matchDetailId,
              matchDetailIdType: typeof matchDetailId
            });
            
            // === 步驟 1: 獲取 match_id ===
            console.log('🔍 步驟 1: 查詢 match_id...');
            const { data: matchDetailData, error: matchDetailError } = await supabase
              .from('contest_match_detail')
              .select('match_id, match_detail_id, score, winner_team_id')
              .eq('match_detail_id', matchDetailId)
              .single();
              
            console.log('📊 查詢 contest_match_detail 結果:', {
              data: matchDetailData,
              error: matchDetailError,
              查詢條件: { match_detail_id: matchDetailId }
            });
              
            if (matchDetailError) {
              console.error('❌ 獲取 match_id 失敗:', matchDetailError);
              console.error('❌ 錯誤詳情:', {
                message: matchDetailError.message,
                details: matchDetailError.details,
                hint: matchDetailError.hint,
                code: matchDetailError.code
              });
              return;
            }
            
            if (!matchDetailData) {
              console.error('❌ 未找到對應的 match_detail_id:', matchDetailId);
              return;
            }
            
            const matchId = matchDetailData.match_id;
            console.log('✅ 成功獲取 match_id:', matchId);
            console.log('📋 當前比賽詳情狀態:', {
              現有比分: matchDetailData.score,
              現有獲勝隊伍: matchDetailData.winner_team_id
            });
            
            // === 步驟 2: 獲取隊伍 ID ===
            console.log('🔍 步驟 2: 查詢隊伍資料...');
            const { data: matchData, error: matchError } = await supabase
              .from('contest_match')
              .select('team1_id, team2_id, match_id')
              .eq('match_id', matchId)
              .single();
              
            console.log('📊 查詢 contest_match 結果:', {
              data: matchData,
              error: matchError,
              查詢條件: { match_id: matchId }
            });
              
            if (matchError) {
              console.error('❌ 獲取隊伍 ID 失敗:', matchError);
              console.error('❌ 錯誤詳情:', {
                message: matchError.message,
                details: matchError.details,
                hint: matchError.hint,
                code: matchError.code
              });
              return;
            }
            
            if (!matchData) {
              console.error('❌ 未找到對應的 match_id:', matchId);
              return;
            }
            
            console.log('✅ 成功獲取隊伍資料:', matchData);
            
            // === 步驟 3: 計算比分 ===
            console.log('🧮 步驟 3: 計算比分...');
            console.log('📋 原始對應關係:');
            console.log('  team1 對應選手:', originalPlayer1Name);
            console.log('  team2 對應選手:', originalPlayer2Name);
            console.log('📋 當前界面顯示:');
            console.log('  上方選手:', redMemberName, '星號數:', topWins);
            console.log('  下方選手:', greenMemberName, '星號數:', bottomWins);
            
            // 根據原始對應關係計算每個隊伍的得分
            let team1Score, team2Score;
            
            if (originalPlayer1Name === redMemberName) {
              // team1的選手在上方（紅色區塊）
              team1Score = topWins;
              team2Score = bottomWins;
              console.log('✅ team1選手', originalPlayer1Name, '在上方，得分:', team1Score);
              console.log('✅ team2選手', originalPlayer2Name, '在下方，得分:', team2Score);
            } else if (originalPlayer1Name === greenMemberName) {
              // team1的選手在下方（綠色區塊）
              team1Score = bottomWins;
              team2Score = topWins;
              console.log('✅ team1選手', originalPlayer1Name, '在下方，得分:', team1Score);
              console.log('✅ team2選手', originalPlayer2Name, '在上方，得分:', team2Score);
            } else {
              console.error('❌ 無法匹配 team1 選手:', {
                originalPlayer1Name,
                currentPlayers: { red: redMemberName, green: greenMemberName }
              });
              return;
            }
            
            // === 步驟 4: 判定獲勝隊伍 ===
            console.log('🏆 步驟 4: 判定獲勝隊伍...');
            const battleWinnerTeamId = team1Score > team2Score ? matchData.team1_id : 
                                      team2Score > team1Score ? matchData.team2_id : null;
            
            console.log('📊 隊伍比分:', `team1(${team1Score}) vs team2(${team2Score})`);
            console.log('🏆 獲勝隊伍 ID:', battleWinnerTeamId);
            
            if (battleWinnerTeamId) {
              console.log('✅ 獲勝原因:', team1Score > team2Score ? 
                `team1 得分較高 (${team1Score} > ${team2Score})` : 
                `team2 得分較高 (${team2Score} > ${team1Score})`);
            } else {
              console.log('🤝 比賽結果: 平局');
            }
            
            // === 步驟 5: 準備更新資料 ===
            const finalContestScore = `${team1Score}:${team2Score}`;
            console.log('📝 戰況室比分格式:', finalContestScore);
            
            const updateData = {
              score: finalContestScore,
              winner_team_id: battleWinnerTeamId
            };
            
            console.log('📋 準備更新的資料:', updateData);
            console.log('📋 更新條件:', { match_detail_id: matchDetailId });
            
            // === 步驟 6: 執行更新 ===
            console.log('💾 步驟 6: 執行資料庫更新...');
            
            // 先檢查當前登入用戶的權限
            console.log('👤 當前登入用戶資訊:', {
              name: currentLoggedInUser?.name,
              role: currentLoggedInUser?.role,
              team_id: currentLoggedInUser?.team_id
            });
            
            const { data: updateResult, error: updateScoreError } = await supabase
              .from('contest_match_detail')
              .update(updateData)
              .eq('match_detail_id', matchDetailId)
              .select(); // 加上 select() 來獲取更新後的資料
              
            console.log('📊 更新結果:', {
              data: updateResult,
              error: updateScoreError
            });
              
            if (updateScoreError) {
              console.error('❌ 更新比賽分數失敗:', updateScoreError);
              console.error('❌ 詳細錯誤資訊:', {
                message: updateScoreError.message,
                details: updateScoreError.details,
                hint: updateScoreError.hint,
                code: updateScoreError.code
              });
              
              // 嘗試檢查是否是權限問題
              console.log('🔍 嘗試檢查資料庫權限...');
              const { data: testRead, error: testReadError } = await supabase
                .from('contest_match_detail')
                .select('match_detail_id, score, winner_team_id')
                .eq('match_detail_id', matchDetailId)
                .single();
                
              console.log('📊 讀取權限測試:', {
                canRead: !testReadError,
                readData: testRead,
                readError: testReadError
              });
              
              return;
            } 
            
            console.log('✅ 戰況室比賽分數更新成功！');
            console.log('📊 更新後的資料:', updateResult);
            
            // === 步驟 7: 查詢獲勝隊伍名稱 ===
            if (battleWinnerTeamId) {
              console.log('🔍 步驟 7: 查詢獲勝隊伍名稱...');
              
              // 儲存獲勝隊伍 ID
              setWinnerTeamId(battleWinnerTeamId);
              
              try {
                const { data: teamData, error: teamError } = await supabase
                  .from('contest_team')
                  .select('name, contest_team_id')
                  .eq('contest_team_id', battleWinnerTeamId)
                  .single();
                  
                console.log('📊 查詢隊伍名稱結果:', {
                  data: teamData,
                  error: teamError,
                  查詢條件: { contest_team_id: battleWinnerTeamId }
                });
                  
                if (teamError) {
                  console.error('❌ 查詢獲勝隊伍名稱失敗:', teamError);
                } else if (teamData) {
                  setWinnerTeamName(teamData.name);
                  console.log('✅ 獲勝隊伍名稱:', teamData.name);
                } else {
                  console.warn('⚠️ 未找到獲勝隊伍資料');
                }
              } catch (teamErr) {
                console.error('❌ 查詢獲勝隊伍資料發生錯誤:', teamErr);
              }
            }
            
            console.log('🎉 戰況室更新流程完成！');
            
          } catch (updateErr) {
            console.error('💥 更新比賽詳情時發生嚴重錯誤:', updateErr);
            console.error('💥 錯誤堆疊:', updateErr.stack);
          }
        }
        
        // 如果是從戰況室進入，具備自動返回功能
        if (isFromBattleroom) {
          console.log('從戰況室進入並完成儲存，準備返回上一頁...');
          setTimeout(() => {
            console.log('自動返回上一頁');
            navigate(-1);
          }, 1500);
        }
        
        // 儲存成功後自動重置遊戲狀態
        resetGameState();
        setGameHistory([]);
        setCurrentGameNumber(1);
      }
      
      setTimeout(() => setShowSubmitMessage(false), 3000);
    } catch (err) {
      console.error('提交過程中發生錯誤:', err);
      setSubmitStatus('error');
      setSubmitMessage('儲存時發生錯誤');
      setTimeout(() => setShowSubmitMessage(false), 3000);
    }
  };

  // Get minus/W button styles based on player position (top/bottom)
  const getButtonStyle = (isTop: boolean, isW: boolean = false) => {
    const baseColor = isTop 
      ? 'bg-red-600'
      : 'bg-green-600';  
    
    const hoverColor = isTop 
      ? 'hover:bg-red-700'
      : 'hover:bg-green-700';  
    
    const disabledClass = `opacity-40 cursor-not-allowed`;
    const enabledClass = `${hoverColor} shadow-lg transform hover:scale-110 transition-all`;
    
    // For W button, it's always enabled when game is not over
    const isDisabled = isW ? gameOver : gameOver || (isTop ? topScore <= 0 : bottomScore <= 0);
    
    const margin = isW ? 'ml-6' : 'mr-6';
    const cursorClass = isW ? 'cursor-grab active:cursor-grabbing' : '';
    
    return `
      w-12 h-12 rounded-full ${baseColor} flex items-center justify-center 
      text-white font-bold text-2xl ${margin} border-2 border-white
      ${!isDisabled ? `${enabledClass} ${cursorClass}` : disabledClass}
    `;
  };

  // 約戰按鈕點擊事件（修正版：傳遞正確的選手ID，並添加防呆檢查）
  const handleChallengeClick = async () => {
    // 1. 首先檢查是否有 matchDetailId 且是否已存在約戰記錄
    if (matchDetailId) {
      console.log('[約戰] 檢查比賽ID是否已有約戰記錄:', matchDetailId);
      // 查詢主挑戰表（challenges），與 double_game 一致
      const { data: challengeData, error: challengeError } = await supabase
        .from('challenges')
        .select('challenge_id')
        .eq('match_detail_id', matchDetailId)
        .maybeSingle();
      console.log('[約戰] 查詢結果:', { challengeData, challengeError });

      if (challengeData) {
        // contest模式：已有約戰記錄，彈窗詢問用戶是否要覆蓋
        const confirmUpdate = window.confirm('此比賽已經有約戰記錄。\n要刪除現有約戰記錄並建立新的嗎？');
        console.log('[約戰] 用戶選擇:', confirmUpdate ? '確定' : '取消');
        if (!confirmUpdate) {
          // 用戶取消，不覆蓋
          return;
        }
        // 用戶選擇覆蓋，刪除現有主挑戰記錄
        console.log('[約戰] 開始刪除約戰記錄...');
        const { error: deleteError } = await supabase
          .from('challenges')
          .delete()
          .eq('match_detail_id', matchDetailId);
        console.log('[約戰] 刪除結果:', { deleteError });
        if (deleteError) {
          console.error('[約戰] 刪除記錄時發生錯誤:', deleteError);
          setSubmitStatus('error');
          setSubmitMessage('刪除舊約戰記錄時發生錯誤');
          setShowSubmitMessage(true);
          setTimeout(() => setShowSubmitMessage(false), 3000);
          return;
        } else {
          console.log('[約戰] 已刪除現有約戰記錄，準備創建新約戰');
        }
      }

      if (challengeError) {
        console.error('[約戰] 查詢挑戰記錄錯誤:', challengeError);
      }
    }
    
    // 2. 若無已存在約戰，繼續原本的流程
    console.log('[約戰] 準備創建新約戰...');
    const teamId = currentLoggedInUser?.team_id || '';
    // 查詢 teamName
    const { data, error } = await supabase.from('courts').select('name').eq('team_id', teamId).maybeSingle();
    const teamName = data?.name || teamId;
    console.log('[約戰] 約戰場地資訊:', { teamId, teamName, error });
    
    // 根據名稱查找對應的成員ID
    const redMemberId = members.find(m => m.name === redMemberName)?.id || '';
    const greenMemberId = members.find(m => m.name === greenMemberName)?.id || '';
    
    console.log('[約戰] 選手資訊:', {
      紅色選手: { 名稱: redMemberName, ID: redMemberId },
      綠色選手: { 名稱: greenMemberName, ID: greenMemberId }
    });
    
    console.log('[約戰] 將導航至創建約戰頁面...');
    navigate('/create-challenge', {
      state: {
        teamId,
        teamName,
        playerIds: [redMemberId, greenMemberId].filter(Boolean),
        matchDetailId: matchDetailId ? matchDetailId.toString() : undefined // 添加 matchDetailId 到導航狀態
      }
    });
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const p1 = params.get('player1_name');
    const p2 = params.get('player2_name');
    if (p1) setRedMemberName(p1);
    if (p2) setGreenMemberName(p2);
  }, [location.search]);

  // 判斷是否顯示上下交換按鈕
  const canShowSwapButton = (
    redMemberName && greenMemberName &&
    topScore === 0 && bottomScore === 0 && gameHistory.length === 0
  );

  // 獲取所有會員資料並通過名字匹配
  const fetchAllMembersAndMatchByNames = async (
    p1Name: string | null, 
    p2Name: string | null
  ) => {
    try {
      console.log('開始獲取所有會員資料並匹配名字...');
      const { data, error } = await supabase
        .from('members')
        .select('*')
        .order('team_id', { ascending: true })
        .order('name', { ascending: true });
        
      if (error) {
        console.error('獲取所有會員資料錯誤:', error);
        return;
      }
      
      if (data && data.length > 0) {
        console.log('獲取到的所有會員資料:', data.length, '筆');
        
        // 設置所有會員資料
        setMembers(data);
        
        // 通過名字匹配選手
        if (p1Name) {
          const redMatch = data.find(m => m.name === p1Name);
          if (redMatch) {
            console.log('匹配到紅色選手:', redMatch.name, '(ID:', redMatch.id, ')');
            setRedMemberName(redMatch.name);
          } else {
            console.log('未找到匹配的紅色選手:', p1Name);
          }
        }
        
        if (p2Name) {
          const greenMatch = data.find(m => m.name === p2Name);
          if (greenMatch) {
            console.log('匹配到綠色選手:', greenMatch.name, '(ID:', greenMatch.id, ')');
            setGreenMemberName(greenMatch.name);
          } else {
            console.log('未找到匹配的綠色選手:', p2Name);
          }
        }
      } else {
        console.log('未獲取到會員資料');
      }
    } catch (error) {
      console.error('查詢會員資料出錯:', error);
    }
  };
  
  // 獲取所有會員資料
  const fetchAllMembers = async () => {
    try {
      console.log('開始獲取所有會員資料...');
      const { data, error } = await supabase
        .from('members')
        .select('*')
        .order('team_id', { ascending: true })
        .order('name', { ascending: true });
        
      if (error) {
        console.error('獲取所有會員資料錯誤:', error);
        return;
      }
      
      if (data) {
        console.log('獲取到的所有會員資料:', data.length, '筆');
        setMembers(data);
      }
    } catch (error) {
      console.error('查詢會員資料出錯:', error);
    }
  };

  // 新增：處理選手選擇變更，清除自動選擇標記
  const handlePlayerSelection = (player: 'red' | 'green', memberName: string) => {
    if (player === 'red') {
      setRedMemberName(memberName);
      // 如果是紅色選手且之前是自動選擇，清除標記
      if (autoSelectedPlayer === 'red') {
        setAutoSelectedPlayer(null);
      }
    } else {
      setGreenMemberName(memberName);
      // 如果是綠色選手且之前是自動選擇，清除標記
      if (autoSelectedPlayer === 'green') {
        setAutoSelectedPlayer(null);
      }
    }
  };

  // 新增：獲取選手選單的樣式
  const getPlayerSelectStyle = (player: 'red' | 'green') => {
    const baseStyle = "w-full p-2 rounded bg-gray-800 text-white border border-gray-700";
    
    // 如果是自動選擇的選手，添加特殊樣式
    if (autoSelectedPlayer === player) {
      return `${baseStyle} border-yellow-400 shadow-lg shadow-yellow-400/30`;
    }
    
    return baseStyle;
  };

  return (
    <div className="p-4">
      {/* 顯示登入會員名稱與團隊 */}
      <div className="mb-2 text-lg font-bold text-blue-700 flex items-center">
        <span>登入者：{currentLoggedInUser?.name || '未登入'}（{teamName}隊）</span>
      </div>
      <div className="min-h-screen bg-black flex flex-col items-center justify-between py-8">
        <div className="w-full max-w-md flex justify-between items-center px-4">
          <span style={{ position: 'absolute', left: 60, top: 48, color: 'white', fontSize: 18 }}>va3</span>
          <div className="flex items-center">
            <button 
              onClick={toggleSound}
              className="text-gray-400 hover:text-white transition-colors mr-4"
              title={soundEnabled ? "聲音開啟" : "聲音關閉"}
            >
              {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
            <button 
              onClick={handleReset}
              className="text-gray-400 hover:text-white transition-colors"
              title="重置"
            >
              <RotateCcw size={20} />
            </button>
          </div>
          
          {/* 約戰按鈕 */}
          <div>
            <button 
              onClick={handleChallengeClick}
              className={`ml-2 px-4 py-2 rounded ${
                sourceType === 'contest' && matchDetailId ? 'bg-gray-400 text-gray-600' : 'bg-green-600 text-white'
              }`}
              title={sourceType === 'contest' && matchDetailId ? "請從戰況室使用約戰功能" : "約戰"}
              disabled={sourceType === 'contest' && matchDetailId ? true : !currentLoggedInUser}
            >
              📣
            </button>
          </div>
          
          {/* 來源標示 */}
          <span
            className={`px-3 py-2 rounded text-white font-bold text-lg select-none ${sourceType === 'challenge' ? 'bg-blue-500' : 'bg-green-500'}`}
            title={sourceType === 'challenge' ? '挑戰賽' : '賽程'}
            style={{ letterSpacing: 2 }}
          >
            {sourceType === 'challenge' ? 'C' : 'R'}
          </span>
          <button
            onClick={toggleFinalGame}
            className={`px-4 py-2 rounded ${isFinalGame 
                ? `${fgButtonVisible ? 'bg-red-600' : 'bg-red-800'}` 
                : 'bg-gray-700 text-gray-300'} text-white transition-colors`}
          >
            FG
          </button>
          <button 
            onClick={submitGameResult}
            className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isSaveDisabled || submitStatus === 'loading' || hasSaved}
            title={hasSaved ? '已經儲存過了' : isSaveDisabled ? '請先完成至少一場比賽或比賽已完成' : '儲存比賽結果'}
          >
            儲存
          </button>
        </div>

        {/* 新增比賽已完成的提示訊息 */}
        {isMatchCompleted && (
          <div className="w-full max-w-md text-center text-yellow-400 font-bold text-xl mt-4">
            此場比賽已完成，比分已記錄，無法再次儲存。
          </div>
        )}

        <div className="w-full max-w-md flex items-center justify-center">
          <button 
            onClick={decrementTopScore}
            className={getButtonStyle(true)}
            disabled={gameOver || topScore <= 0}
          >
            <div className="w-6 h-1 bg-white rounded-full"></div>
          </button>
          <div className="text-white text-6xl font-bold">{topScore}</div>
          <div 
            id="top-w-button"
            draggable={!gameOver}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onClick={() => handleWButtonClick('top')}
            className={getButtonStyle(true, true)}
          >
            <div className="text-white font-bold text-lg">W</div>
          </div>
        </div>

        <div className="w-full max-w-md flex relative">
          {/* Top row: Red */}
          <div style={{ display: 'flex', width: '100%' }}>
            {/* 紅色區塊 */}
            <div style={{ flex: 1, padding: 8, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <select
                value={redMemberName}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  handlePlayerSelection('red', e.target.value);
                }}
                className={getPlayerSelectStyle('red')}
              >
                <option value="">選擇選手</option>
                {members.map((member: { id: string; name: string; team_id: string }) => (
                  <option
                    key={member.id}
                    value={member.name}
                    disabled={member.name === greenMemberName && greenMemberName !== ''}
                  >
                    {member.team_id} - {member.name}（{memberPointsMap[member.id]?.points ?? 0}分，第{memberPointsMap[member.id]?.rank ?? '-'}名）
                  </option>
                ))}
              </select>
              <button 
                key={`top-0`}
                className={`${getSquareStyle(topColors[0], isTopServing)} relative`}
                onClick={incrementTopScore}
                disabled={gameOver}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, 'top')}
                style={{ width: '100%', height: '100px', position: 'relative' }}
              >
                <span className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-white text-4xl font-bold">
                  {renderStars(getWins(true))}
                </span>
                {isTopServing && !gameOver && (
                  <div className="absolute bottom-2 right-2 w-4 h-4 bg-white rounded-full animate-pulse"></div>
                )}
              </button>
            </div>
          </div>
          {/* 中央上下交換按鈕 */}
          {canShowSwapButton && (
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: '100%',
                transform: 'translate(-50%, 0)',
                zIndex: 30,
                pointerEvents: 'auto',
              }}
            >
              <button
                style={{
                  fontSize: 28,
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  background: '#444',
                  color: '#fff',
                  border: '2px solid #888',
                  cursor: 'pointer',
                  opacity: 1,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
                }}
                title="交換上下選手"
                onClick={() => {
                  // 交換上下選手（不交換顏色）
                  const prevTop = redMemberName;
                  const prevBottom = greenMemberName;
                  setRedMemberName(prevBottom);
                  setGreenMemberName(prevTop);
                  // 交換次數加一
                  setSwapCount(prev => prev + 1);
                  console.log('=== 交換選手與顏色區塊對應關係 ===');
                  console.log('交換前：');
                  console.log('  紅色區塊(上方)：', prevTop);
                  console.log('  綠色區塊(下方)：', prevBottom);
                  console.log('交換後：');
                  console.log('  紅色區塊(上方)：', prevBottom);
                  console.log('  綠色區塊(下方)：', prevTop);
                  console.log('交換次數:', swapCount + 1); // +1 因為 state 更新是非同步的
                }}
              >
                ⇅
              </button>
            </div>
          )}
        </div>

        <div className="w-full max-w-md">
          <div className="flex flex-wrap justify-center gap-4 text-white">
            {gameHistory.map((game: GameScore, index: number) => (
              <div key={index} className="text-center">
                <div className="text-lg font-bold">{game.topScore}</div>
                <div className="text-sm text-gray-400">Game {index + 1}</div>
                <div className="text-lg font-bold">{game.bottomScore}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="w-full max-w-md flex">
          {/* Bottom row: Green */}
          <div style={{ display: 'flex', width: '100%' }}>
            {/* 綠色區塊 */}
            <div style={{ flex: 1, padding: 8, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <button 
                key={`bottom-0`}
                className={`${getSquareStyle(bottomColors[0], !isTopServing)} relative`}
                onClick={incrementBottomScore}
                disabled={gameOver}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, 'bottom')}
                style={{ width: '100%', height: '100px', position: 'relative' }}
              >
                <span className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-white text-4xl font-bold">
                  {renderStars(getWins(false))}
                </span>
                {!isTopServing && !gameOver && (
                  <div className="absolute top-2 right-2 w-4 h-4 bg-white rounded-full animate-pulse"></div>
                )}
              </button>
              <select
                value={greenMemberName}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  handlePlayerSelection('green', e.target.value);
                }}
                className={getPlayerSelectStyle('green')}
              >
                <option value="">選擇選手</option>
                {members.map((member: { id: string; name: string; team_id: string }) => (
                  <option
                    key={member.id}
                    value={member.name}
                    disabled={member.name === redMemberName && redMemberName !== ''}
                  >
                    {member.team_id} - {member.name}（{memberPointsMap[member.id]?.points ?? 0}分，第{memberPointsMap[member.id]?.rank ?? '-'}名）
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="w-full max-w-md flex items-center justify-center">
          <button 
            onClick={decrementBottomScore}
            className={getButtonStyle(false)}
            disabled={gameOver || bottomScore <= 0}
          >
            <div className="w-6 h-1 bg-white rounded-full"></div>
          </button>
          <div className="text-white text-6xl font-bold">{bottomScore}</div>
          <div 
            id="bottom-w-button"
            draggable={!gameOver}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onClick={() => handleWButtonClick('bottom')}
            className={getButtonStyle(false, true)}
          >
            <div className="text-white font-bold text-lg">W</div>
          </div>
        </div>

        {showWinConfirmation && (
          <div className="absolute inset-0 bg-black bg-opacity-80 flex items-center justify-center">
            <div className="bg-gray-800 p-6 rounded-lg text-white text-center">
              <h2 className="text-2xl font-bold mb-4">確認勝利?</h2>
              <p className="mb-6">確定要宣告{winSide === 'top' ? '上方' : '下方'}獲勝嗎?</p>
              <div className="flex justify-center space-x-4">
                <button 
                  onClick={cancelWin}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded"
                >
                  取消
                </button>
                <button 
                  onClick={confirmWin}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded"
                >
                  確認
                </button>
              </div>
            </div>
          </div>
        )}

        {showSubmitMessage && (
          <div className="absolute inset-0 bg-black bg-opacity-80 flex items-center justify-center">
            <div className="bg-gray-800 p-6 rounded-lg text-white text-center">
              <h2 className="text-2xl font-bold mb-4">{submitMessage}</h2>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SingleGame;
