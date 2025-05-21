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
    }
  };

  // 在組件掛載和URL變更時處理參數
  useEffect(() => {
    processUrlParameters();
  }, [location.search]);

  useEffect(() => {
    const fetchMembersAndPoints = async () => {
      console.log('當前來源狀態:', isFromBattleroom ? '戰況室' : '一般挑戰賽');
      
      // 從URL獲取選手名稱
      const params = new URLSearchParams(location.search);
      const p1Name = params.get('player1_name');
      const p2Name = params.get('player2_name');
      
      // 從 sessionStorage 獲取 member_id (可能來自戰況室或約戰頁面)
      const p1MemberId = sessionStorage.getItem('player1_member_id');
      const p2MemberId = sessionStorage.getItem('player2_member_id');
      
      console.log('選手資訊:', { p1Name, p2Name, p1MemberId, p2MemberId });
      
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
        
        // 處理會員 ID 參數 - 適用於戰況室和約戰頁面
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

      // 設置會員列表
      setMembers(allMembers);

      // 3. 合併成績與排名
      const pointsMap: { [memberId: string]: { points: number; rank: number|string } } = {};
      
      // 從所有會員中篩選出非比賽選手的 ID，避免將非 UUID 格式的 ID 用於查詢
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
      
      // 如果是從戰況室進入，檢查比賽是否已完成
      if (isFromBattleroom && matchDetailId) {
        console.log('戰況室模式，檢查比賽是否已完成，matchDetailId:', matchDetailId);
        const { data, error } = await supabase
          .from('contest_match_detail')
          .select('score')
          .eq('match_detail_id', matchDetailId)
          .not('score', 'is', null) // 檢查 score 是否不為 null
          .maybeSingle();
          
        if (error) {
          console.error('查詢比賽完成狀態錯誤:', error);
        } else if (data) {
          console.log('比賽已完成，比分:', data.score);
          setIsMatchCompleted(true); // 比賽已完成
        } else {
          console.log('比賽尚未完成');
          setIsMatchCompleted(false); // 比賽尚未完成
        }
      }
      
      // 如果還沒有通過 ID 設置選手，嘗試通過名稱匹配
      if (!redMember || !greenMember) {
        console.log('嘗試通過名稱匹配選手');
        
        if (p1Name && !redMember) {
          // 在現有清單中尋找名字匹配的選手
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
          // 在現有清單中尋找名字匹配的選手
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
      resetGameState();
    }
  }, [currentGameNumber]);
  
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
      return;
    }

    // Check if all members are selected
    if (!redMember || !greenMember) {
      setSubmitStatus('error');
      setSubmitMessage('請選擇所有位置的會員');
      setShowSubmitMessage(true);
      setTimeout(() => setShowSubmitMessage(false), 3000);
      return;
    }

    setSubmitStatus('loading');
    setShowSubmitMessage(true);
    setSubmitMessage('儲存中...');
    
    try {
      // 取得登入者名稱
      const loginUserName = currentLoggedInUser?.name ?? '訪客';

      // Determine the winning player based on the number of wins (stars)
      const winningPlayer = redWins > greenWins ? 'red' : 'green';
      
      // 確認上下交換次數是奇數還是偶數
      const isSwapped = swapCount % 2 === 1;
      
      // 根據交換次數結果選擇比分表示方式
      const score = isSwapped ? `${greenWins}:${redWins}` : `${redWins}:${greenWins}`;
      console.log('儲存比分:', score, '(原始比分:', `${redWins}:${greenWins}`, '交換次數:', swapCount, '是否已交換:', isSwapped, ')');
      
      // 獲取會員名稱
      const redMemberObj = members.find(m => m.name === redMemberName);
      const greenMemberObj = members.find(m => m.name === greenMemberName);
      
      const redMemberNameVal = redMemberObj?.name || redMemberName || '';
      const greenMemberNameVal = greenMemberObj?.name || greenMemberName || '';
      
      console.log('會員資料:', members);
      console.log('選擇的會員:', { redMemberName, greenMemberName });
      console.log('會員名稱:', { redMemberNameVal, greenMemberNameVal });
      
      // 準備要提交的資料 - 確保欄位名稱與資料庫結構完全匹配
      const gameData = {
        player1: redMemberNameVal,  // 紅色會員名稱
        player2: greenMemberNameVal,  // 綠色會員名稱
        score: score,
        created_by_name: loginUserName, // 登錄者
        notes: `${new Date().toISOString()} - 單打比賽`,
        team_id: currentLoggedInUser?.team_id || 'T', // 沒登入時給預設值 'T'
        source_type: sourceType, // 預設為 'challenge'
        source_id: isFromBattleroom && matchDetailId ? matchDetailId.toString() : null, // 如果是從戰況室進入，記錄match_detail_id
      };
      
      // 記錄關聯信息
      if (isFromBattleroom && matchDetailId) {
        console.log(`關聯戰況室比賽ID: ${matchDetailId} 到單打記錄`);
      }
      
      console.log('準備提交的資料:', gameData);
      
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
        
        // 如果是從戰況室進入，更新比賽詳情的比分
        if (isFromBattleroom && matchDetailId) {
          try {
            console.log('從戰況室進入，開始更新 contest_match_detail 資料表...');
            
            // 首先獲取 match_id
            const { data: matchDetailData, error: matchDetailError } = await supabase
              .from('contest_match_detail')
              .select('match_id')
              .eq('match_detail_id', matchDetailId)
              .single();
              
            if (matchDetailError) {
              console.error('獲取 match_id 失敗:', matchDetailError);
              return;
            }
            
            const matchId = matchDetailData.match_id;
            console.log('獲取到 match_id:', matchId);
            
            // 然後獲取 team1_id 和 team2_id
            const { data: matchData, error: matchError } = await supabase
              .from('contest_match')
              .select('team1_id, team2_id')
              .eq('match_id', matchId)
              .single();
              
            if (matchError) {
              console.error('獲取隊伍 ID 失敗:', matchError);
              return;
            }
            
            console.log('獲取到隊伍資料:', matchData);
            
            // 根據獲勝方決定 winner_team_id
            // 已在上方計算了 isSwapped
            console.log('儲存比分時的交換次數:', swapCount, '是否已交換:', isSwapped);
            
            // 如果交換次數為奇數，則需要翻轉勝負判斷
            const winnerTeamId = isSwapped 
              ? (redWins > greenWins ? matchData.team2_id : matchData.team1_id)
              : (redWins > greenWins ? matchData.team1_id : matchData.team2_id);
            
            console.log('獲勝隊伍 ID:', winnerTeamId, 
              '(紅色勝場:', redWins, '綠色勝場:', greenWins, 
              '交換次數:', swapCount, '是否已交換:', isSwapped, ')');
            
            // 從當前比賽詳情獲取權限號
            const { data: currentMatchDetail, error: currentMatchDetailError } = await supabase
              .from('contest_match_detail')
              .select('table_no')
              .eq('match_detail_id', matchDetailId)
              .single();
            
            if (currentMatchDetailError) {
              console.error('獲取當前比賽權限號失敗:', currentMatchDetailError);
              return;
            }
            
            // 只記錄目前比賽的狀態，不進行桌次處理
            console.log('當前比賽狀態 - 比賽 ID:', matchDetailId, '分數:', score, '獲勝隊伍:', winnerTeamId);
            
            // 只更新比分和獲勝隊伍 ID，桌次分配由後端 SQL 觸發器處理
            const { error: updateScoreError } = await supabase
              .from('contest_match_detail')
              .update({ 
                score: score,
                winner_team_id: winnerTeamId
              })
              .eq('match_detail_id', matchDetailId);
              
            if (updateScoreError) {
              console.error('更新比賽分數失敗:', updateScoreError);
              return; // 如果更新分數失敗，直接返回
            } 
            
            console.log('比賽分數更新成功，更新資料:', { score, winner_team_id: winnerTeamId });
            console.log('桌次分配由後端 SQL 觸發器自動處理');
            
            // 儲存獲勝隊伍 ID
            setWinnerTeamId(winnerTeamId);
            
            // 查詢獲勝隊伍名稱
            try {
              const { data: teamData, error: teamError } = await supabase
                .from('contest_team')
                .select('name')
                .eq('contest_team_id', winnerTeamId)
                .single();
                
              if (teamError) {
                console.error('查詢獲勝隊伍名稱失敗:', teamError);
              } else if (teamData) {
                setWinnerTeamName(teamData.name);
                console.log('獲勝隊伍名稱:', teamData.name);
              }
            } catch (teamErr) {
              console.error('查詢獲勝隊伍資料發生錯誤:', teamErr);
            }
          } catch (updateErr) {
            console.error('更新比賽詳情時發生錯誤:', updateErr);
          }
        }
        
        // 如果是從戰況室進入，具備自動返回功能
        if (isFromBattleroom) {
          console.log('從戰況室進入並完成儲存，準備返回上一頁...');
          setTimeout(() => {
            console.log('自動返回上一頁');
            navigate(-1); // 使用 navigate(-1) 返回上一頁
          }, 1500); // 等待 1.5 秒後自動返回，讓用戶有時間看到成功訊息
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
                  setRedMemberName(e.target.value);
                }}
                className="w-full p-2 rounded bg-gray-800 text-white border border-gray-700"
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
                  setGreenMemberName(e.target.value);
                }}
                className="w-full p-2 rounded bg-gray-800 text-white border border-gray-700"
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
        
        {gameOver && !showWinConfirmation && (
          <div className="absolute inset-0 bg-black bg-opacity-80 flex items-center justify-center">
            <div className="text-white text-4xl font-bold text-center">
              Game Over!<br />
              {
                gameHistory.length > 0 && 
                gameHistory[gameHistory.length - 1].topScore === "W" ? 'Top' :
                gameHistory.length > 0 && 
                gameHistory[gameHistory.length - 1].bottomScore === "W" ? 'Bottom' :
                topScore > bottomScore ? 'Top' : 'Bottom'
              } wins!<br />
              <button 
                onClick={handleReset}
                className="mt-4 px-6 py-2 bg-white text-black text-xl rounded-lg hover:bg-gray-200 transition-colors"
              >
                下一局
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SingleGame;