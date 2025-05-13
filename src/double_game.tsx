import React, { useState, useEffect, useRef, DragEvent } from 'react';
import { useAudioEffects } from './hooks/useAudioEffects';
import { usePlayerManagement } from './hooks/usePlayerManagement';
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
  team_id?: string;
  [key: string]: any;
}

interface Member {
  id: string;
  name: string;
  team_id: string;
  member_id?: string;
}

interface Court {
  team_id: string;
  name: string;
}

function DoubleGame() {
  const [topScore, setTopScore] = useState(0);
  const [bottomScore, setBottomScore] = useState(0);
  const [isTopFlashing, setIsTopFlashing] = useState(true);
  const [isVisible, setIsVisible] = useState(true);
  const [topColors, setTopColors] = useState(['red', 'green']);
  const [bottomColors, setBottomColors] = useState(['blue', 'yellow']);
  const [gameOver, setGameOver] = useState(false);
  const [gameHistory, setGameHistory] = useState<GameScore[]>([]);
  const [currentGameNumber, setCurrentGameNumber] = useState(1);
  const [isFinalGame, setIsFinalGame] = useState(false);
  const [fgButtonVisible, setFgButtonVisible] = useState(true);
  // 使用音效處理 Hook
  const {
    soundEnabled,
    toggleSound,
    playScoreSound,
    playSwitchSound,
    playGameOverSound,
    playFGSound,
    playWinSound
  } = useAudioEffects();
  const [hasSaved, setHasSaved] = useState(false);
  
  // Drag and drop related states
  const [showWinConfirmation, setShowWinConfirmation] = useState(false);
  const [winSide, setWinSide] = useState<'top' | 'bottom' | null>(null);
  
  // Double-click W button tracking
  const topWLastClickTime = useRef<number>(0);
  const bottomWLastClickTime = useRef<number>(0);
  const doubleClickDelay = 300; // milliseconds between clicks to count as double-click
  
  // AudioContext reference 已移至 useAudioEffects Hook
  
  const previousTopScoreRef = useRef(0);
  const previousBottomScoreRef = useRef(0);
  const previousTotalScoreRef = useRef(0);
  const fgSpecialRuleAppliedRef = useRef(false);
  const hasReachedFiveRef = useRef(false);
  const [manualFgToggled, setManualFgToggled] = useState(false);
  
  // 使用玩家管理 Hook
  const {
    // 玩家狀態
    members,
    memberPointsMap,
    redMember,
    setRedMember,
    greenMember,
    setGreenMember,
    blueMember,
    setBlueMember,
    yellowMember,
    setYellowMember,
    
    // 比賽詳情
    isFromBattleroom,
    matchDetailId,
    team1Members,
    team2Members,
    team1Id,
    team2Id,
    
    // 當前用戶
    currentLoggedInUser,
    
    // 功能函數
    getTeamLetter,
    swapTopPlayers,
    swapBottomPlayers,
    swapCourt
  } = usePlayerManagement();
  
  // 新增場地交換次數計數器，用於追蹤場地交換狀態
  const [positionSwapCount, setPositionSwapCount] = useState(0);
  
  // 新增要寫入資料表的比分顯示
  const [finalScoreInfo, setFinalScoreInfo] = useState<string>('');
  
  // 比分顯示會在獲勝場次計算後更新
  
  // 交換次數狀態說明
  // 交換次數為奇數時，表示場地已交換
  // 交換次數為偶數時，表示場地未交換（原始狀態）
  // currentLoggedInUser 已由 usePlayerManagement Hook 管理

  // 取得網址 query string 並自動帶入選手
  const location = useLocation();
  
  // 從 URL 獲取參數相關功能已移至 usePlayerManagement Hook
  // 當 members 或 URL 參數變動時才設定預設值，並加上 debug log
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const p1 = params.get('player1');
    const p2 = params.get('player2');
    const p3 = params.get('player3');
    const p4 = params.get('player4');
    console.log('double_game.tsx debug:', {
      url: location.search,
      player1: p1, player2: p2, player3: p3, player4: p4,
      members
    });
    
    // 先轉成連結全部成員 id 與 member_id
    if (members.length > 0) {
      console.log('所有成員:', members.map(m => ({ id: m.id, member_id: m.member_id, name: m.name })));
      
      // 比較靈活的匹配方式，檢查 id 或 member_id 的尾部是否相符
      const findMemberByShortId = (shortId: string | null) => {
        if (!shortId) return null;
        
        // 先完全匹配 member_id
        const exactMatch = members.find(m => m.member_id === shortId);
        if (exactMatch) {
          console.log(`找到完全匹配 ${shortId}:`, exactMatch);
          return exactMatch;
        }
        
        // 再完全匹配 id
        const idMatch = members.find(m => m.id === shortId);
        if (idMatch) {
          console.log(`找到ID匹配 ${shortId}:`, idMatch);
          return idMatch;
        }
        
        // 再查看 id 或 member_id 是否以這個短 ID 結尾
        const endMatch = members.find(m => 
          (m.id && m.id.endsWith(shortId)) || 
          (m.member_id && m.member_id.endsWith(shortId)));
        
        if (endMatch) {
          console.log(`找到尾部匹配 ${shortId}:`, endMatch);
          return endMatch;
        }
        
        console.log(`未找到成員 ${shortId}`);
        return null;
      };
      
      const red = findMemberByShortId(p1);
      const green = findMemberByShortId(p2);
      const blue = findMemberByShortId(p3);
      const yellow = findMemberByShortId(p4);
      
      console.log('find:', {red, green, blue, yellow});
      
      if (red) setRedMember(red.id);
      if (green) setGreenMember(green.id);
      if (blue) setBlueMember(blue.id);
      if (yellow) setYellowMember(yellow.id);
    }
  }, [members, location.search]);

  // 提交結果狀態
  const [submitStatus, setSubmitStatus] = useState<'success' | 'error' | 'loading'>('success');
  const [submitMessage, setSubmitMessage] = useState('');
  const [showSubmitMessage, setShowSubmitMessage] = useState(false);

  // 玩家查詢邏輯已移至 usePlayerManagement Hook

  // 音效相關功能已移至 useAudioEffects hook
  // 重置遊戲狀態
  const resetGameState = (preserveFG = false) => {
    setTopScore(0);
    setBottomScore(0);
    setTopColors(['red', 'green']);
    setBottomColors(['blue', 'yellow']);
    setGameOver(false);
    setIsVisible(true);
    previousTopScoreRef.current = 0;
    previousBottomScoreRef.current = 0;
    previousTotalScoreRef.current = 0;
    
    // 只有在不保留FG狀態時才重置FG相關設置
    if (!preserveFG) {
      fgSpecialRuleAppliedRef.current = false;
      // 不重置isFinalGame，而是保留其當前狀態
    } else {
      // 如果是保留FG狀態，只重置FG特殊規則的應用標記
      fgSpecialRuleAppliedRef.current = false;
    }
    
    hasReachedFiveRef.current = false;

    const isOddGame = currentGameNumber % 2 === 1;
    setIsTopFlashing(!isOddGame);
    
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
  setIsTopFlashing(!isOddGame);
  
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
      setIsVisible(prev => !prev);
    }, 500);

    return () => clearInterval(interval);
  }, [gameOver]);

  useEffect(() => {
    if (!isFinalGame) return;
    
    const interval = setInterval(() => {
      setFgButtonVisible(prev => !prev);
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

    if (isFinalGame) {
      // For Final Game logic
      if (firstTimeReachingFive && !fgSpecialRuleAppliedRef.current) {
        fgSpecialRuleAppliedRef.current = true;
        
        if (currentIsEven) {
          setIsTopFlashing(prev => !prev);
          sideChanged = true;
        } else {
          if (isTopFlashing) {
            setBottomColors(prev => [prev[1], prev[0]]);
            // 使用 hook 提供的函數交換底部玩家
            swapBottomPlayers();
          } else {
            setTopColors(prev => [prev[1], prev[0]]);
            // 使用 hook 提供的函數交換頂部玩家
            swapTopPlayers();
          }
        }
      } else if (isScoreDecrement) {
        // Handle score decrease - ONLY change flashing if parity changed
        if (parityChanged) {
          setIsTopFlashing(prev => !prev);
          sideChanged = true;
          
          // For FG mode: Handle color swapping if needed when flashing side changes
          if (isTopFlashing) {
            setBottomColors(prev => [prev[1], prev[0]]);
            // 使用 hook 提供的函數交換底部玩家
            swapBottomPlayers();
          } else {
            setTopColors(prev => [prev[1], prev[0]]);
            // 使用 hook 提供的函數交換頂部玩家
            swapTopPlayers();
          }
        }
      } else if (currentIsEven || isDeuce) {
        // Original logic for incrementing scores
        setIsTopFlashing(prev => !prev);
        sideChanged = true;
        if (isTopFlashing) {
          setTopColors(prev => [prev[1], prev[0]]);
          // 使用 hook 提供的函數交換頂部玩家
          swapTopPlayers();
        } else {
          setBottomColors(prev => [prev[1], prev[0]]);
          // 使用 hook 提供的函數交換底部玩家
          swapBottomPlayers();
        }
      }
    } else {
      // Regular game logic
      if (isScoreDecrement) {
        // Handle score decrease - ONLY change flashing if parity changed
        if (parityChanged) {
          setIsTopFlashing(prev => !prev);
          sideChanged = true;
          
          // Swap colors based on who was flashing before
          if (isTopFlashing) {
            setBottomColors(prev => [prev[1], prev[0]]);
            // 使用 hook 提供的函數交換底部玩家
            swapBottomPlayers();
          } else {
            setTopColors(prev => [prev[1], prev[0]]);
            // 使用 hook 提供的函數交換頂部玩家
            swapTopPlayers();
          }
        }
      } else if (isDeuce || (totalScore > 0 && totalScore % 2 === 0)) {
        // Original logic for incrementing scores
        setIsTopFlashing(prev => !prev);
        sideChanged = true;
        if (isTopFlashing) {
          setTopColors(prev => [prev[1], prev[0]]);
          // 使用 hook 提供的函數交換頂部玩家
          swapTopPlayers();
        } else {
          setBottomColors(prev => [prev[1], prev[0]]);
          // 使用 hook 提供的函數交換底部玩家
          swapBottomPlayers();
        }
      }
    }
    
    // Play switch side sound if flashing side changed
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
  }, [topScore, bottomScore, isFinalGame, isTopFlashing]);

  useEffect(() => {
    if (!isFinalGame) return;
    
    const interval = setInterval(() => {
      setFgButtonVisible(prev => !prev);
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

    if (isFinalGame) {
      // For Final Game logic
      if (firstTimeReachingFive && !fgSpecialRuleAppliedRef.current) {
        fgSpecialRuleAppliedRef.current = true;
        
        if (currentIsEven) {
          setIsTopFlashing(prev => !prev);
          sideChanged = true;
        } else {
          if (isTopFlashing) {
            setBottomColors(prev => [prev[1], prev[0]]);
            // 使用 hook 提供的函數交換底部玩家
            swapBottomPlayers();
          } else {
            setTopColors(prev => [prev[1], prev[0]]);
            // 使用 hook 提供的函數交換頂部玩家
            swapTopPlayers();
          }
        }
      } else if (isScoreDecrement) {
        // Handle score decrease - ONLY change flashing if parity changed
        if (parityChanged) {
          setIsTopFlashing(prev => !prev);
          sideChanged = true;
          
          // For FG mode: Handle color swapping if needed when flashing side changes
          if (isTopFlashing) {
            setBottomColors(prev => [prev[1], prev[0]]);
            // 使用 hook 提供的函數交換底部玩家
            swapBottomPlayers();
          } else {
            setTopColors(prev => [prev[1], prev[0]]);
            // 使用 hook 提供的函數交換頂部玩家
            swapTopPlayers();
          }
        }
      } else if (currentIsEven || isDeuce) {
        // Original logic for incrementing scores
        setIsTopFlashing(prev => !prev);
        sideChanged = true;
        if (isTopFlashing) {
          setTopColors(prev => [prev[1], prev[0]]);
          // 使用 hook 提供的函數交換頂部玩家
          swapTopPlayers();
        } else {
          setBottomColors(prev => [prev[1], prev[0]]);
          // 使用 hook 提供的函數交換底部玩家
          swapBottomPlayers();
        }
      }
    } else {
      // Regular game logic
      if (isScoreDecrement) {
        // Handle score decrease - ONLY change flashing if parity changed
        if (parityChanged) {
          setIsTopFlashing(prev => !prev);
          sideChanged = true;
          
          // Swap colors based on who was flashing before
          if (isTopFlashing) {
            setBottomColors(prev => [prev[1], prev[0]]);
            // 使用 hook 提供的函數交換底部玩家
            swapBottomPlayers();
          } else {
            setTopColors(prev => [prev[1], prev[0]]);
            // 使用 hook 提供的函數交換頂部玩家
            swapTopPlayers();
          }
        }
      } else if (isDeuce || (totalScore > 0 && totalScore % 2 === 0)) {
        // Original logic for incrementing scores
        setIsTopFlashing(prev => !prev);
        sideChanged = true;
        if (isTopFlashing) {
          setTopColors(prev => [prev[1], prev[0]]);
          // 使用 hook 提供的函數交換頂部玩家
          swapTopPlayers();
        } else {
          setBottomColors(prev => [prev[1], prev[0]]);
          // 使用 hook 提供的函數交換底部玩家
          swapBottomPlayers();
        }
      }
    }
    
    // Play switch side sound if flashing side changed
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
  }, [topScore, bottomScore, isFinalGame, isTopFlashing]);

  useEffect(() => {
    if (!isFinalGame) return;
    
    const interval = setInterval(() => {
      setFgButtonVisible(prev => !prev);
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

    if (isFinalGame) {
      // For Final Game logic
      if (firstTimeReachingFive && !fgSpecialRuleAppliedRef.current) {
        fgSpecialRuleAppliedRef.current = true;
        
        if (currentIsEven) {
          setIsTopFlashing(prev => !prev);
          sideChanged = true;
        } else {
          if (isTopFlashing) {
            setBottomColors(prev => [prev[1], prev[0]]);
            // 使用 hook 提供的函數交換底部玩家
            swapBottomPlayers();
          } else {
            setTopColors(prev => [prev[1], prev[0]]);
            // 使用 hook 提供的函數交換頂部玩家
            swapTopPlayers();
          }
        }
      } else if (isScoreDecrement) {
        // Handle score decrease - ONLY change flashing if parity changed
        if (parityChanged) {
          setIsTopFlashing(prev => !prev);
          sideChanged = true;
          
          // For FG mode: Handle color swapping if needed when flashing side changes
          if (isTopFlashing) {
            setBottomColors(prev => [prev[1], prev[0]]);
            // 使用 hook 提供的函數交換底部玩家
            swapBottomPlayers();
          } else {
            setTopColors(prev => [prev[1], prev[0]]);
            // 使用 hook 提供的函數交換頂部玩家
            swapTopPlayers();
          }
        }
      } else if (currentIsEven || isDeuce) {
        // Original logic for incrementing scores
        setIsTopFlashing(prev => !prev);
        sideChanged = true;
        if (isTopFlashing) {
          setTopColors(prev => [prev[1], prev[0]]);
          // 使用 hook 提供的函數交換頂部玩家
          swapTopPlayers();
        } else {
          setBottomColors(prev => [prev[1], prev[0]]);
          // 使用 hook 提供的函數交換底部玩家
          swapBottomPlayers();
        }
      }
    } else {
      // Regular game logic
      if (isScoreDecrement) {
        // Handle score decrease - ONLY change flashing if parity changed
        if (parityChanged) {
          setIsTopFlashing(prev => !prev);
          sideChanged = true;
          
          // Swap colors based on who was flashing before
          if (isTopFlashing) {
            setBottomColors(prev => [prev[1], prev[0]]);
            // 使用 hook 提供的函數交換底部玩家
            swapBottomPlayers();
          } else {
            setTopColors(prev => [prev[1], prev[0]]);
            // 使用 hook 提供的函數交換頂部玩家
            swapTopPlayers();
          }
        }
      } else if (isDeuce || (totalScore > 0 && totalScore % 2 === 0)) {
        // Original logic for incrementing scores
        setIsTopFlashing(prev => !prev);
        sideChanged = true;
        if (isTopFlashing) {
          setTopColors(prev => [prev[1], prev[0]]);
          // 使用 hook 提供的函數交換頂部玩家
          swapTopPlayers();
        } else {
          setBottomColors(prev => [prev[1], prev[0]]);
          // 使用 hook 提供的函數交換底部玩家
          swapBottomPlayers();
        }
      }
    }
    
    // Play switch side sound if flashing side changed
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
  }, [topScore, bottomScore, isFinalGame, isTopFlashing]);

  const handleReset = () => {
    if (gameOver) {
      setCurrentGameNumber(prev => prev + 1);
    } else {
      resetGameState();
    }
  };

 const toggleFinalGame = () => {
  const newState = !isFinalGame;
  setIsFinalGame(newState);
  setManualFgToggled(true); // Mark that user has manually toggled FG
  
  if (newState) {
    playFGSound();
  }
  
  if (!isFinalGame) {
    fgSpecialRuleAppliedRef.current = false;
  }
};
  
  // toggleSound 函數已移至 useAudioEffects hook

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

  const getSquareStyle = (color: string, isCurrentSideFlashing: boolean) => {
    const baseColor = {
      'red': 'bg-red-600 hover:bg-red-700',
      'green': 'bg-green-600 hover:bg-green-700',
      'blue': 'bg-blue-600 hover:bg-blue-700',
      'yellow': 'bg-yellow-400 hover:bg-yellow-500',
    }[color];

    return `w-1/2 aspect-square ${baseColor} transition-colors ${
      isCurrentSideFlashing && !isVisible ? 'opacity-50' : 'opacity-100'
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

  // Get minus/W button styles based on player position (top/bottom)
  const getButtonStyle = (isTop: boolean, isW: boolean = false) => {
    const baseColor = isTop 
      ? topColors[0] === 'red' ? 'bg-red-600' : 'bg-green-600'
      : bottomColors[0] === 'blue' ? 'bg-blue-600' : 'bg-yellow-400';
    
    const hoverColor = isTop 
      ? topColors[0] === 'red' ? 'hover:bg-red-700' : 'hover:bg-green-700'
      : bottomColors[0] === 'blue' ? 'hover:bg-blue-700' : 'hover:bg-yellow-500';
    
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

  // 雙方勝場皆為0時禁止儲存
  const topWins = getWins(true);
  const bottomWins = getWins(false);
  const isSaveDisabled = topWins === 0 && bottomWins === 0;
  
  // 即時更新顯示比分資訊
  useEffect(() => {
    // 判斷交換狀態
    const isSwapped = positionSwapCount % 2 === 1;
    
    // 根據交換狀態確定比分格式
    let tempFormattedScore = "";
    if (isSwapped) {
      // 已交換狀態，比分格式應為 bottomWins:topWins
      tempFormattedScore = `${bottomWins}:${topWins}`;
    } else {
      // 未交換狀態，比分格式應為 topWins:bottomWins
      tempFormattedScore = `${topWins}:${bottomWins}`;
    }
    
    // 更新比分顯示
    setFinalScoreInfo(`寫入資料表比分: ${tempFormattedScore}`);
  }, [topWins, bottomWins, positionSwapCount]);

  // 彈窗控制狀態
  const [showPostSaveModal, setShowPostSaveModal] = useState(false);

  // 提交比賽結果到後端
  const submitGameResult = async () => {
    // 如果已儲存過，就不再重複儲存
    if (hasSaved) {
      return;
    }

    // 檢查所有會員是否已選擇
    if (!redMember || !greenMember || !blueMember || !yellowMember) {
      setSubmitStatus('error');
      setSubmitMessage('請選擇所有位置的會員');
      setShowSubmitMessage(true);
      setTimeout(() => setShowSubmitMessage(false), 3000);
      return;
    }

    try {
      setSubmitStatus('loading');
      setSubmitMessage('儲存中...');
      setShowSubmitMessage(true);

      // 取得登入者名稱
      const loginUserName = currentLoggedInUser?.name ?? '訪客';

      // 獲取實際勝場數作為分數（基於星號數量）
      const topWins = getWins(true);  // 上方獲勝場次
      const bottomWins = getWins(false);  // 下方獲勝場次
      
      console.log('實際獲勝場次:', { topWins, bottomWins });
      console.log('遊戲歷史:', gameHistory);

      // --- 送出時改用 id 查找會員資料 ---
      const getMemberById = (id: string): Member | undefined => {
        return members.find((member: Member) => member.id === id);
      };

      // 送出時用 id 查找會員資訊
      const red = getMemberById(redMember);
      const green = getMemberById(greenMember);
      const blue = getMemberById(blueMember);
      const yellow = getMemberById(yellowMember);
      
      // 判斷哪一方獲勝
      const isTopWinner = topWins > bottomWins;
      
      // 判斷是否有交換過場地，用於後續的比分計算
      const isSwapped = positionSwapCount % 2 === 1;
      console.log('DEBUG: 目前交換狀態:', {
        positionSwapCount,
        isSwapped: isSwapped ? '已交換' : '未交換'
      });
      
      // 根據交換次數調整獲勝隊伍
      // 如果沒有交換，則 isTopWinner 對應 team1，否則 isTopWinner 對應 team2
      let tempWinnerTeamId;
      if (isSwapped) {
        // 已交換，頂部獲勝對應 team2，底部獲勝對應 team1
        tempWinnerTeamId = isTopWinner ? team2Id : team1Id;
        console.log('DEBUG: 已交換狀態下，獲勝隊伍為:', isTopWinner ? 'team2(頂部)' : 'team1(底部)');
      } else {
        // 未交換，頂部獲勝對應 team1，底部獲勝對應 team2
        tempWinnerTeamId = isTopWinner ? team1Id : team2Id;
        console.log('DEBUG: 未交換狀態下，獲勝隊伍為:', isTopWinner ? 'team1(頂部)' : 'team2(底部)');
      }
      
      // 轉換為數字以便比較
      let numericWinnerTeamId = parseInt(String(tempWinnerTeamId), 10);
      console.log('DEBUG: 獲勝隊伍 ID:', numericWinnerTeamId);
      
      // 定義比分格式
      let formattedScore = "";
      
      // 必須根據交換狀態調整比分順序
      const team1Numeric = parseInt(String(team1Id), 10);
      const team2Numeric = parseInt(String(team2Id), 10);
      
      // 判斷是否需要翻轉比分順序
      if (isSwapped) {
        // 已交換狀態，比分順序應為 "bottomWins:topWins"
        formattedScore = `${bottomWins}:${topWins}`;
        console.log('DEBUG: 已交換狀態，比分格式應為 team2:team1 即', formattedScore);
      } else {
        // 未交換狀態，比分順序應為 "topWins:bottomWins"
        formattedScore = `${topWins}:${bottomWins}`;
        console.log('DEBUG: 未交換狀態，比分格式應為 team1:team2 即', formattedScore);
      }
      
      // 創建顯示用的資訊字串，包含寫入資料表的比分
      const scoreInfo = `寫入資料表比分: ${formattedScore}`;
      console.log('DEBUG:', scoreInfo,
                '獲勝隊伍 ID:', numericWinnerTeamId,
                '交換次數:', positionSwapCount,
                '交換狀態:', positionSwapCount % 2 === 1 ? '已交換' : '未交換');
      
      // 更新狀態變量以顯示寫入資料表的比分
      setFinalScoreInfo(scoreInfo);
      
      // 確認獲勝隊伍和分數是否合理
      if ((isTopWinner && topWins <= bottomWins) || (!isTopWinner && bottomWins <= topWins)) {
        console.log('WARNING: 獲勝隊伍和顯示分數不匹配！獲勝隊伍應該有更高的分數');
      }

      // 送出團隊id與名字（不送id）
      const gameData = {
        player1: red?.name,
        player2: green?.name,
        player3: blue?.name,
        player4: yellow?.name,
        team_id: currentLoggedInUser?.team_id || 'T',
        score: formattedScore,
        win1_name: isTopWinner ? red?.name : blue?.name,
        win2_name: isTopWinner ? green?.name : yellow?.name,
        notes: `${new Date().toISOString()} - Auto recorded, 場次數:${gameHistory.length}`,
        created_by_name: loginUserName, // 新增這行
        source_type: isFromBattleroom ? 'contest' : 'challenge', // 根據來源設置類型
        source_id: isFromBattleroom && matchDetailId ? matchDetailId : null, // 設置來源ID
      };
      const { data, error: insertError } = await supabase
        .from('g_double_game')
        .insert([gameData])
        .select();
        
      if (insertError) {
        console.error('儲存比賽結果失敗:', insertError);
        setSubmitStatus('error');
        setSubmitMessage(`儲存失敗: ${insertError.code} - ${insertError.message || '請重試'}`);
        setTimeout(() => setShowSubmitMessage(false), 5000);
        return;
      }

      console.log('儲存成功, 回應:', data);
      setSubmitStatus('success');
      setSubmitMessage('比賽結果已成功儲存！');
      // 設置為已儲存，禁用儲存按鈕
      setHasSaved(true);
      
      // 如果是從戰況室進入，更新 contest_match_detail 表並自動返回
      if (isFromBattleroom && matchDetailId) {
        try {
          console.log('DEBUG: 開始更新戰況室比賽結果...');
          console.log('DEBUG: 當前狀態:', {
            isFromBattleroom,
            matchDetailId,
            redMember, greenMember, blueMember, yellowMember
          });
          
          // 獲取獲勝選手姓名
          const winnerName1 = gameData.win1_name;
          const winnerName2 = gameData.win2_name;
          
          console.log('DEBUG: 獲勝選手:', { winnerName1, winnerName2 });
          console.log('DEBUG: 隊伍成員列表:', {
            team1Members,
            team2Members,
            team1Id,
            team2Id
          });
          
          console.log('DEBUG: 選手名稱: ', {
            red: red?.name,
            green: green?.name,
            blue: blue?.name,
            yellow: yellow?.name
          });
          
          // 判斷獲勝隊伍
          let winnerTeamId = null;
          
          // 手動檢查整個比對狀況
          if (!team1Members.length || !team2Members.length) {
            console.warn('DEBUG: 隊伍成員列表為空，改用備用比對方法');
            
            // 備用方法：直接檢查紅綠 vs 藍黃
            const topTeamWins = topWins > bottomWins;
            winnerTeamId = topTeamWins ? team1Id : team2Id;
            
            console.log('DEBUG: 備用方法判斷獲勝隊伍:', {
              topWins,
              bottomWins,
              topTeamWins,
              winnerTeamId
            });
          } else {
            // 檢查獲勝選手是否在隊伍1
            const isTeam1Winner = team1Members.some(name => 
              name === winnerName1 || name === winnerName2
            );
            
            console.log('DEBUG: 檢查獲勝選手在哪個隊伍:', {
              isTeam1Winner,
              check: team1Members.map(name => ({ 
                name, 
                matchWinner1: name === winnerName1,
                matchWinner2: name === winnerName2
              }))
            });
            
            if (isTeam1Winner) {
              winnerTeamId = team1Id;
              console.log('DEBUG: 隊伍1獲勝, ID:', winnerTeamId);
            } else {
              winnerTeamId = team2Id;
              console.log('DEBUG: 隊伍2獲勝, ID:', winnerTeamId);
            }
          }
          
          // 強制轉換為整數類型
          const numericMatchDetailId = parseInt(matchDetailId, 10);
          const numericWinnerTeamId = parseInt(String(winnerTeamId), 10);

          console.log('DEBUG: 準備更新 contest_match_detail，參數(轉換後):', {
            numericMatchDetailId,
            score: formattedScore,
            numericWinnerTeamId,
            originalValues: { matchDetailId, winnerTeamId }
          });
          
          // 使用 SQL 直接更新
          // Supabase的SQL API可能比RPC更直接
          const sqlQuery = `
            UPDATE contest_match_detail 
            SET score = '${formattedScore}', winner_team_id = ${numericWinnerTeamId} 
            WHERE match_detail_id = ${numericMatchDetailId}
          `;

          console.log('DEBUG: 將執行的SQL:', sqlQuery);
          
          try {
            const { data: updateData, error: updateError } = await supabase
              .rpc('execute_sql', { sql_query: sqlQuery });
            
            if (updateError) {
              console.error('DEBUG: SQL更新失敗:', updateError);
              
              // 備用方案：使用標準API再試一次
              console.log('DEBUG: 嘗試使用標準API更新');
              const { data: backupData, error: backupError } = await supabase
                .from('contest_match_detail')
                .update({
                  score: formattedScore,
                  winner_team_id: numericWinnerTeamId
                })
                .eq('match_detail_id', numericMatchDetailId)
                .select();
              
              if (backupError) {
                console.error('DEBUG: 標準API更新也失敗:', backupError);
              } else {
                console.log('DEBUG: 標準API更新成功', backupData);
              }
            } else {
              console.log('DEBUG: SQL更新成功', updateData);
            }
          } catch (sqlError) {
            console.error('DEBUG: SQL執行出錯:', sqlError);
            
            // 備用方案：使用標準update API
            const { data: fallbackData, error: fallbackError } = await supabase
              .from('contest_match_detail')
              .update({
                score: formattedScore,
                winner_team_id: numericWinnerTeamId
              })
              .eq('match_detail_id', numericMatchDetailId)
              .select();
            
            if (fallbackError) {
              console.error('DEBUG: 備用更新失敗:', fallbackError);
            } else {
              console.log('DEBUG: 備用更新成功', fallbackData);
            }
          }
          
          // 自動返回戰況室
          console.log('準備返回戰況室頁面...');
          setTimeout(() => {
            navigate(-1);
          }, 1500);
          
        } catch (error) {
          console.error('更新戰況室比賽結果失敗:', error);
        }
      }
      
      // 儲存成功後顯示後續選擇彈窗
      setShowPostSaveModal(true);
      setTimeout(() => setShowSubmitMessage(false), 3000);
    } catch (error) {
      console.error('儲存過程發生未預期的錯誤:', error);
      setSubmitStatus('error');
      setSubmitMessage(`儲存時發生錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`);
      setTimeout(() => setShowSubmitMessage(false), 5000);
    }
  };

  // 約戰相關狀態
  const [isChallengeMode, setIsChallengeMode] = useState(false);
  const [challengeDate, setChallengeDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [challengeTimeSlot, setChallengeTimeSlot] = useState('中');

  // --- 新增 courts 狀態 ---
  const [courts, setCourts] = useState<Court[]>([]);

  useEffect(() => {
    const fetchCourts = async () => {
      const { data, error } = await supabase.from('courts').select('team_id, name');
      if (!error && data) setCourts(data);
    };
    fetchCourts();
  }, []);

  const navigate = useNavigate();
  // 跳轉到創建挑戰頁前查詢 team_name 並傳遞
  const handleCreateChallenge = async (teamId: string, playerIds: string[]) => {
    const { data, error } = await supabase.from('courts').select('name').eq('team_id', teamId).maybeSingle();
    const teamName = data?.name || teamId;
    navigate('/create-challenge', { state: { teamId, teamName, playerIds } });
  };

  // 根據ID獲取會員資訊
  const getMemberById = (id: string): Member | undefined => {
    return members.find((member: Member) => member.id === id);
  };

  // 發送挑戰函數
  const handleSendChallenge = async () => {
    if (!challengeDate) {
      alert('請選擇挑戰日期');
      return;
    }

    const userTeamId = currentLoggedInUser?.team_id;
    const playerIds = [redMember, greenMember, blueMember, yellowMember];
    handleCreateChallenge(userTeamId, playerIds);
  };

  // 結束：重設所有狀態
  const handleEndGame = () => {
    setTopScore(0);
    setBottomScore(0);
    setTopColors(['red', 'green']);
    setBottomColors(['blue', 'yellow']);
    setGameOver(false);
    setIsVisible(true);
    previousTopScoreRef.current = 0;
    previousBottomScoreRef.current = 0;
    previousTotalScoreRef.current = 0;
    fgSpecialRuleAppliedRef.current = false;
    hasReachedFiveRef.current = false;
    setIsTopFlashing(true);
    setIsFinalGame(false);
    setShowWinConfirmation(false);
    setWinSide(null);
    setGameHistory([]);
    setCurrentGameNumber(1);
    setRedMember('');
    setGreenMember('');
    setBlueMember('');
    setYellowMember('');
    setHasSaved(false);
    setShowPostSaveModal(false);
  };

  // 再來一盤：保留選手，交換上下位置並各自對調
  const handlePlayAgain = () => {
    setTopScore(0);
    setBottomScore(0);
    setGameOver(false);
    setIsVisible(true);
    previousTopScoreRef.current = 0;
    previousBottomScoreRef.current = 0;
    previousTotalScoreRef.current = 0;
    fgSpecialRuleAppliedRef.current = false;
    hasReachedFiveRef.current = false;
    setIsTopFlashing(true);
    setIsFinalGame(false);
    setShowWinConfirmation(false);
    setWinSide(null);
    setGameHistory([]);
    setCurrentGameNumber(1);
    // 先暫存原本的選手id
    const prevRed = redMember;
    const prevGreen = greenMember;
    const prevBlue = blueMember;
    const prevYellow = yellowMember;
    // 先交換上下兩組
    // 再各自對調
    setRedMember(prevYellow);    // 上面左：原黃
    setGreenMember(prevBlue);    // 上面右：原藍
    setBlueMember(prevGreen);    // 下面左：原綠
    setYellowMember(prevRed);    // 下面右：原紅
    setTopColors(bottomColors);
    setBottomColors(topColors);
    setHasSaved(false);
    setShowPostSaveModal(false);
  };

  // 提交按鈕
  const submitButton = (
    <button 
      onClick={submitGameResult}
      className={`px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white transition-colors ${isSaveDisabled || hasSaved ? 'opacity-50 cursor-not-allowed' : ''}`}
      title={isSaveDisabled ? '請先完成至少一場比賽' : hasSaved ? '已經儲存過了' : '儲存比賽結果'}
      disabled={isSaveDisabled || hasSaved}
    >
      儲存
    </button>
  );

  const challengeButton = (
    <button
      onClick={handleSendChallenge}
      className="px-4 py-2 bg-green-500 text-white rounded"
      disabled={!currentLoggedInUser}
      title="發起約戰"
    >
      📣
    </button>
  );

  // 判斷是否顯示交換按鈕
  const canShowSwapButtons = (
    redMember && greenMember && blueMember && yellowMember &&
    topScore === 0 && bottomScore === 0 && gameHistory.length === 0
  );

  // 已移除上方的交換按鈕，只保留中間的上下交換按鈕

  return (
    <div className="h-screen bg-black flex flex-col justify-center">
      {/* 登入資訊顯示區塊 (改為固定在頂部) */}
      <div className="w-full py-2 px-4 bg-gray-900 text-white text-sm flex justify-between items-center">
        <div>
          {currentLoggedInUser
            ? `${currentLoggedInUser.name || '未知使用者'}（${currentLoggedInUser.role || '未知角色'}，${getTeamLetter(currentLoggedInUser.team_id)}隊）`
            : '未登入（T隊）'}
        </div>
        <div className="flex items-center space-x-3">
          <span className="text-gray-400">vs1.1</span>
          <button 
            onClick={toggleSound}
            className="text-gray-400 hover:text-white transition-colors"
            title={soundEnabled ? "聲音開啟" : "聲音關閉"}
          >
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button 
            onClick={handleReset}
            className="text-gray-400 hover:text-white transition-colors"
            title="重置"
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      {/* 主內容區 (精簡中區，不使用 flex-grow 填滿) */}
      <div className="flex flex-col items-center p-0 gap-0 self-center">
        {/* 上方隊伍區塊 */}
        <div className="w-full max-w-md flex items-center justify-center mb-4 gap-8">
          {/* 來源標示 */}
          <span
            className={`px-3 py-2 rounded text-white font-bold text-lg select-none ${
              location.search.includes('from_battleroom=true') ? 'bg-green-500' : 'bg-blue-500'
            }`}
            title={location.search.includes('from_battleroom=true') ? '賽程' : '挑戰賽'}
            style={{ letterSpacing: 2 }}
          >
            {location.search.includes('from_battleroom=true') ? 'R' : 'C'}
          </span>
          <button
            onClick={toggleFinalGame}
            className={`px-4 py-2 rounded ${
              isFinalGame 
                ? `${fgButtonVisible ? 'bg-red-600' : 'bg-red-800'} text-white` 
                : 'bg-gray-700 text-gray-300'
            } transition-colors`}
          >
            FG
          </button>
          {submitButton}
          {challengeButton}
        </div>

        {/* 上方顏色區塊（紅、綠） */}
        <div className="w-full max-w-md flex flex-col">
          {/* 上方分數區 */}
          <div className="flex justify-center items-center mb-1">
            <button 
              onClick={decrementTopScore}
              className="bg-red-600 rounded-full flex items-center justify-center shadow"
              disabled={gameOver || topScore <= 0}
              style={{ width: 36, height: 36 }}
            >
              <div className="w-5 h-1 bg-white rounded-full"></div>
            </button>
            <div className="text-white text-6xl font-bold mx-4">{topScore}</div>
            <button 
              id="top-w-button"
              draggable={!gameOver}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onClick={() => handleWButtonClick('top')}
              className="bg-red-600 rounded-full flex items-center justify-center shadow"
              style={{ width: 36, height: 36 }}
            >
              <div className="text-white font-bold text-lg">W</div>
            </button>
          </div>

          {/* 顏色區塊容器 */}
          <div className="w-full flex relative">
            <div style={{ display: 'flex', width: '100%' }}>
              {/* 紅色區塊 */}
              <div style={{ flex: 1, padding: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                <select
                  value={redMember}
                  onChange={e => setRedMember(e.target.value)}
                  className="w-full p-2 rounded bg-gray-800 text-white border border-gray-700"
                >
                  <option value="">選擇選手</option>
                  {members.filter(m =>
                    currentLoggedInUser
                      ? m.team_id === currentLoggedInUser.team_id
                      : m.team_id === 'T'
                  ).map(member => {
                    const info = memberPointsMap[member.id] || { points: 0, rank: members.length };
                    return (
                      <option
                        key={member.id}
                        value={member.id}
                        disabled={
                          member.id === greenMember && greenMember !== '' ||
                          member.id === blueMember && blueMember !== '' ||
                          member.id === yellowMember && yellowMember !== ''
                        }
                      >
                        {member.name}（{info.points}分/{info.rank}名）
                      </option>
                    );
                  })}
                </select>
                <button
                  className={getSquareStyle(topColors[0], isTopFlashing)}
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
                </button>
                {/* 紅/綠區塊左右交換按鈕 */}
                {canShowSwapButtons && (
                  <button
                    style={{
                      position: 'absolute',
                      right: '-22px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      zIndex: 10,
                      fontSize: 24,
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      background: '#222',
                      color: '#fff',
                      border: '1px solid #555',
                      cursor: 'pointer',
                      opacity: 1,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.18)'
                    }}
                    title="交換上方兩位選手"
                    onClick={() => {
                      const temp = redMember;
                      setRedMember(greenMember);
                      setGreenMember(temp);
                    }}
                  >
                    ⇄
                  </button>
                )}
              </div>
              {/* 綠色區塊 */}
              <div style={{ flex: 1, padding: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                <select
                  value={greenMember}
                  onChange={e => setGreenMember(e.target.value)}
                  className="w-full p-2 rounded bg-gray-800 text-white border border-gray-700"
                >
                  <option value="">選擇選手</option>
                  {members.filter(m =>
                    currentLoggedInUser
                      ? m.team_id === currentLoggedInUser.team_id
                      : m.team_id === 'T'
                  ).map(member => {
                    const info = memberPointsMap[member.id] || { points: 0, rank: members.length };
                    return (
                      <option
                        key={member.id}
                        value={member.id}
                        disabled={
                          member.id === redMember && redMember !== '' ||
                          member.id === blueMember && blueMember !== '' ||
                          member.id === yellowMember && yellowMember !== ''
                        }
                      >
                        {member.name}（{info.points}分/{info.rank}名）
                      </option>
                    );
                  })}
                </select>
                <button
                  className={getSquareStyle(topColors[1], isTopFlashing)}
                  onClick={incrementTopScore}
                  disabled={gameOver}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, 'top')}
                  style={{ width: '100%', height: '100px', position: 'relative' }}
                >
                  <span className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-white text-4xl font-bold">
                    {/* 綠色區塊星號留空，僅紅色區塊顯示 */}
                  </span>
                </button>
              </div>
            </div>
            {/* 中央上下交換按鈕 */}
            {canShowSwapButtons && (
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
                    boxShadow: '0 2px 8px rgba(0,0,0,0.18)'
                  }}
                  title="交換上下兩組選手"
                  onClick={() => {
                    // 交換選手
                    const prevRed = redMember;
                    const prevGreen = greenMember;
                    const prevBlue = blueMember;
                    const prevYellow = yellowMember;
                    setRedMember(prevBlue);
                    setGreenMember(prevYellow);
                    setBlueMember(prevRed);
                    setYellowMember(prevGreen);
                    
                    // 增加交換次數
                    setPositionSwapCount((prev: number) => prev + 1);
                    
                    // 記錄新的交換次數和狀態
                    console.log('上下交換完成，目前交換次數:', positionSwapCount + 1);
                    console.log('交換後狀態:', (positionSwapCount + 1) % 2 === 1 ? '已交換' : '未交換');
                  }}
                >
                  ⇅
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 中央計分版 - 上下排列 */}
        <div className="w-full max-w-md py-0 my-1">
          <div className="flex flex-wrap justify-center gap-4 text-white">
            {gameHistory.map((game, index) => (
              <div key={index} className="text-center">
                <div className="text-lg font-bold">{game.topScore}</div>
                <div className="text-lg font-bold">{game.bottomScore}</div>
                <div className="text-sm text-gray-400">Game {index + 1}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 下方顏色區塊（藍、黃） */}
        <div className="w-full max-w-md flex flex-col">
          {/* 顏色區塊容器 */}
          <div className="w-full flex relative">
            <div style={{ display: 'flex', width: '100%' }}>
              {/* 藍色區塊 */}
              <div style={{ flex: 1, padding: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                <select
                  value={blueMember}
                  onChange={e => setBlueMember(e.target.value)}
                  className="w-full p-2 rounded bg-gray-800 text-white border border-gray-700"
                >
                  <option value="">選擇選手</option>
                  {members.filter(m =>
                    currentLoggedInUser
                      ? m.team_id === currentLoggedInUser.team_id
                      : m.team_id === 'T'
                  ).map(member => {
                    const info = memberPointsMap[member.id] || { points: 0, rank: members.length };
                    return (
                      <option
                        key={member.id}
                        value={member.id}
                        disabled={
                          member.id === redMember && redMember !== '' ||
                          member.id === greenMember && greenMember !== '' ||
                          member.id === yellowMember && yellowMember !== ''
                        }
                      >
                        {member.name}（{info.points}分/{info.rank}名）
                      </option>
                    );
                  })}
                </select>
                <button
                  className={getSquareStyle(bottomColors[0], !isTopFlashing)}
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
                </button>
                {/* 藍/黃區塊左右交換按鈕 */}
                {canShowSwapButtons && (
                  <button
                    style={{
                      position: 'absolute',
                      right: '-22px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      zIndex: 10,
                      fontSize: 24,
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      background: '#222',
                      color: '#fff',
                      border: '1px solid #555',
                      cursor: 'pointer',
                      opacity: 1,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.18)'
                    }}
                    title="交換下方兩位選手"
                    onClick={() => {
                      const temp = blueMember;
                      setBlueMember(yellowMember);
                      setYellowMember(temp);
                    }}
                  >
                    ⇄
                  </button>
                )}
              </div>
              {/* 黃色區塊 */}
              <div style={{ flex: 1, padding: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                <select
                  value={yellowMember}
                  onChange={e => setYellowMember(e.target.value)}
                  className="w-full p-2 rounded bg-gray-800 text-white border border-gray-700"
                >
                  <option value="">選擇選手</option>
                  {members.filter(m =>
                    currentLoggedInUser
                      ? m.team_id === currentLoggedInUser.team_id
                      : m.team_id === 'T'
                  ).map(member => {
                    const info = memberPointsMap[member.id] || { points: 0, rank: members.length };
                    return (
                      <option
                        key={member.id}
                        value={member.id}
                        disabled={
                          member.id === redMember && redMember !== '' ||
                          member.id === greenMember && greenMember !== '' ||
                          member.id === blueMember && blueMember !== ''
                        }
                      >
                        {member.name}（{info.points}分/{info.rank}名）
                      </option>
                    );
                  })}
                </select>
                <button
                  className={getSquareStyle(bottomColors[1], !isTopFlashing)}
                  onClick={incrementBottomScore}
                  disabled={gameOver}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, 'bottom')}
                  style={{ width: '100%', height: '100px', position: 'relative' }}
                >
                  <span className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-white text-4xl font-bold">
                    {/* 黃色區塊星號留空，僅藍色區塊顯示 */}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* 下方分數區 */}
          <div className="flex justify-center items-center mt-1">
            <button
              onClick={decrementBottomScore}
              className="bg-blue-600 rounded-full flex items-center justify-center shadow"
              disabled={gameOver || bottomScore <= 0}
              style={{ width: 36, height: 36 }}
            >
              <div className="w-5 h-1 bg-white rounded-full"></div>
            </button>
            <div className="text-white text-6xl font-bold mx-4">{bottomScore}</div>
            <button
              id="bottom-w-button"
              draggable={!gameOver}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onClick={() => handleWButtonClick('bottom')}
              className="bg-blue-600 rounded-full flex items-center justify-center shadow"
              style={{ width: 36, height: 36 }}
            >
              <div className="text-white font-bold text-lg">W</div>
            </button>
          </div>
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
      {showSubmitMessage && (
        <div className="absolute inset-0 bg-black bg-opacity-80 flex items-center justify-center">
          <div className="bg-gray-800 p-6 rounded-lg text-white text-center">
            <h2 className="text-2xl font-bold mb-4">{submitMessage}</h2>
          </div>
        </div>
      )}
      {showPostSaveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-8 flex flex-col items-center max-w-xs w-full">
            <div className="text-lg font-bold mb-4 text-gray-800">比賽結果已成功儲存！</div>
            <div className="mb-6 text-gray-700">請選擇接下來的動作：</div>
            <div className="flex gap-4">
              <button
                className="px-4 py-2 bg-gray-700 text-white rounded"
                onClick={handleEndGame}
              >結束</button>
              <button
                className="px-4 py-2 bg-blue-600 text-white rounded"
                onClick={handlePlayAgain}
              >再來一盤</button>
            </div>
          </div>
        </div>
      )}
      {isChallengeMode && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-8 flex flex-col items-center max-w-xs w-full">
            <div className="text-lg font-bold mb-4 text-gray-800">發起挑戰</div>
            <div className="mb-6 text-gray-700">請選擇日期和時間：</div>
            <div className="flex flex-col gap-4">
              <input
                type="date"
                className="w-full p-2 border rounded"
                value={challengeDate}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setChallengeDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                onFocus={(e) => e.target.showPicker = true} // 防止點擊觸發關閉
              />
              <select
                className="w-full p-2 border rounded"
                value={challengeTimeSlot}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setChallengeTimeSlot(e.target.value)}
              >
                <option value="早">早上 (8:00-12:00)</option>
                <option value="中">中午 (12:00-17:00)</option>
                <option value="晚">晚上 (17:00-22:00)</option>
              </select>
            </div>
            <div className="flex justify-end space-x-2">
              <button 
                onClick={() => setIsChallengeMode(false)}
                className="px-4 py-2 bg-gray-300 rounded"
              >
                取消
              </button>
              <button 
                onClick={handleSendChallenge}
                className="px-4 py-2 bg-blue-500 text-white rounded"
              >
                發送挑戰
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DoubleGame;
