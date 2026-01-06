# Loop Analysis for game.gateway.ts

## Summary
**Total Loops Found: ~50+ iterations**
- forEach loops: 18 instances
- for...of loops: 6 instances
- Traditional for loops: 2 instances
- Array methods (map/filter): 25+ instances

---

## 1. forEach Loops (18 instances)

### Line 460 - Clear Timeout IDs
```typescript
autoInviteState.timeoutIds.forEach((timeoutId) => clearTimeout(timeoutId));
```
**Purpose**: Clean up pending timeouts when auto-invite is cancelled
**Context**: `handleDisconnect` method

### Line 1011 - Initialize Player Scores/Answers
```typescript
game.players.forEach((playerId) => {
  multiplayerState.playerScores.set(playerId, 0);
  multiplayerState.playerAnswers.set(playerId, []);
  multiplayerState.playerWrongAnswers.set(playerId, 0);
});
```
**Purpose**: Initialize game state for all players
**Context**: `createGame` method

### Line 1032 - Join Participants to Room
```typescript
room.participants.forEach((participantId) => {
  const participantSocket = this.userSockets.get(participantId);
  if (participantSocket) {
    participantSocket.join(room.roomId);
  }
});
```
**Purpose**: Ensure all participants are joined to socket room
**Context**: `createGame` method

### Line 1102 - Process Participant Info (createGame)
```typescript
participantIds.forEach((normalizedId) => {
  const player = usersMap.get(normalizedId);
  const gameProgress = progressMap.get(normalizedId);
  // ... process coins, points, level, winner rate
});
```
**Purpose**: Batch process player information (coins, points, level, winner rate)
**Context**: `createGame` method - builds player metadata

### Line 1419 - Process Eliminated Players
```typescript
allEliminatedPlayers.forEach((eliminatedPlayerId) => {
  if (this.userSockets.has(eliminatedPlayerId)) {
    playersToInclude.add(eliminatedPlayerId);
  }
});
```
**Purpose**: Include eliminated players who are still connected
**Context**: `restartGame` method

### Line 1561 - Initialize Player Scores/Answers (restartGame)
```typescript
newGame.players.forEach((playerId) => {
  multiplayerState.playerScores.set(playerId, 0);
  multiplayerState.playerAnswers.set(playerId, []);
  multiplayerState.playerWrongAnswers.set(playerId, 0);
});
```
**Purpose**: Initialize game state for restarted game
**Context**: `restartGame` method

### Line 1622 - Process Participant Info (restartGame)
```typescript
participantIds.forEach((normalizedId) => {
  // Same as line 1102 - processes player info
});
```
**Purpose**: Batch process player information for restarted game
**Context**: `restartGame` method

### Line 1723 - Join Players to Room (restartGame)
```typescript
finalPlayersList.forEach((playerId) => {
  const playerSocket = this.userSockets.get(playerId);
  if (playerSocket) {
    playerSocket.join(roomId);
  }
});
```
**Purpose**: Join all players (including eliminated) to room
**Context**: `restartGame` method

### Line 1937 - Initialize Player Scores/Answers (startGame)
```typescript
game.players.forEach((playerId) => {
  multiplayerState.playerScores.set(playerId, 0);
  multiplayerState.playerAnswers.set(playerId, []);
  multiplayerState.playerWrongAnswers.set(playerId, 0);
});
```
**Purpose**: Initialize game state
**Context**: `startGame` method

### Line 2750 - Calculate Player Correct Counts
```typescript
players.forEach((playerId) => {
  const answers = playerAnswers.get(playerId) || [];
  const correctCount = answers.filter((a) => a.isCorrect).length;
  playerCorrectCounts.set(playerId, correctCount);
  // ... calculate accuracy
});
```
**Purpose**: Calculate correct answers and accuracy for each player
**Context**: `endMultiplayerGame` method

### Line 2867 - Build Player Answers Array
```typescript
players.forEach((playerId) => {
  const answers = playerAnswers.get(playerId) || [];
  playerAnswersArray.push(
    ...answers.map((answer) => ({
      userId: playerId,
      questionIndex: answer.index,
      // ...
    })),
  );
});
```
**Purpose**: Build array of all player answers for database
**Context**: `endMultiplayerGame` method

### Line 2882 - Build Scores/Accuracy Objects
```typescript
players.forEach((playerId) => {
  scoresObj[playerId] = playerScores.get(playerId) || 0;
  accuracyObj[playerId] = playerAccuracies.get(playerId) || 0;
});
```
**Purpose**: Create scores and accuracy objects
**Context**: `endMultiplayerGame` method

### Line 3358 - Send Invites to Users
```typescript
invitedUserIds.forEach((invitedUserId) => {
  const invitedUserSocket = this.userSockets.get(invitedUserId);
  if (invitedUserSocket) {
    invitedUserSocket.emit('inviteUserResponse', inviteResponse);
  }
});
```
**Purpose**: Send invite notifications to multiple users
**Context**: `inviteUser` method

### Line 3450 - Join Participants to Room (acceptInvite)
```typescript
participants.forEach((participantId) => {
  const participantSocket = this.userSockets.get(participantId);
  if (participantSocket) {
    participantSocket.join(room.roomId);
  }
});
```
**Purpose**: Join all participants to socket room
**Context**: `acceptInvite` method

### Line 3515 - Clear Timeout IDs (auto-invite)
```typescript
autoInviteState.timeoutIds.forEach((timeoutId) => clearTimeout(timeoutId));
```
**Purpose**: Stop sequential invites when game starts
**Context**: `acceptInvite` method - auto-start logic

### Line 3600 - Initialize Player Scores/Answers (auto-start)
```typescript
game.players.forEach((playerId) => {
  multiplayerState.playerScores.set(playerId, 0);
  multiplayerState.playerAnswers.set(playerId, []);
  multiplayerState.playerWrongAnswers.set(playerId, 0);
});
```
**Purpose**: Initialize game state for auto-started game
**Context**: `acceptInvite` method - auto-start logic

### Line 3655 - Process Participant Info (auto-start)
```typescript
participantIds.forEach((normalizedId) => {
  // Same as line 1102 - processes player info
});
```
**Purpose**: Batch process player information for auto-started game
**Context**: `acceptInvite` method - auto-start logic

### Line 3812 - Process Participant Details (acceptInvite)
```typescript
participantIds.forEach((normalizedId) => {
  const participant = usersMap.get(normalizedId);
  // ... build participant details array
});
```
**Purpose**: Build participant details with name, profile image, isHost
**Context**: `acceptInvite` method

---

## 2. for...of Loops (6 instances)

### Line 2432 - Collect All User Answers (Multiplayer)
```typescript
for (const playerId of gameState.players) {
  const playerAnswers = gameState.playerAnswers.get(playerId) || [];
  const currentQuestionAnswer = playerAnswers.find((a) => a.index === currentIndex);
  if (currentQuestionAnswer) {
    allUserAnswers.push({
      userId: playerId,
      userAnswer: currentQuestionAnswer.userAnswer,
      isCorrect: currentQuestionAnswer.isCorrect,
      score: gameState.playerScores.get(playerId) || 0,
    });
  }
}
```
**Purpose**: Collect all answers for current question from all players
**Context**: `handleMultiplayerAnswer` method

### Line 2485 - Handle Timeout for Active Players
```typescript
for (const playerId of activePlayers) {
  const answers = gameState.playerAnswers.get(playerId) || [];
  const alreadyAnswered = answers.some((a) => a.index === currentIndex);
  
  if (!alreadyAnswered) {
    // Mark as wrong answer, handle elimination logic
  }
}
```
**Purpose**: Mark unanswered players as wrong when question times out
**Context**: `handleMultiplayerQuestionTimeout` method

### Line 2585 - Collect Timeout Answers
```typescript
for (const playerId of gameState.players) {
  const playerAnswers = gameState.playerAnswers.get(playerId) || [];
  const currentQuestionAnswer = playerAnswers.find((a) => a.index === currentIndex);
  if (currentQuestionAnswer) {
    allUserAnswers.push({ /* ... */ });
  }
}
```
**Purpose**: Collect all answers including timeout answers
**Context**: `handleMultiplayerQuestionTimeout` method

### Line 2783 - Determine Win/Loss/Draw for Players
```typescript
for (const playerId of players) {
  const playerScore = playerCorrectCounts.get(playerId) || 0;
  
  if (gameState.eliminatedPlayers.has(playerId)) {
    playerResults.set(playerId, 'eliminated');
    // ...
  } else if (isDraw && winners.includes(playerId)) {
    playerResults.set(playerId, 'draw');
    // ...
  } else if (winners.includes(playerId)) {
    playerResults.set(playerId, 'win');
    // ...
  } else {
    playerResults.set(playerId, 'loss');
    // ...
  }
}
```
**Purpose**: Determine game result and award points/coins for each player
**Context**: `endMultiplayerGame` method

### Line 4835 - Filter Available Users (auto-invite)
```typescript
for (const user of onlineUsers) {
  const userId = this.normalizeId(user._id);
  const userType = (user as any)?.userType;
  
  if (!userId || userId === normalizedInviterId || userType !== 'individual') {
    continue;
  }
  
  const userRoom = this.contentService.getRoomByUserId(userId);
  if (userRoom) {
    continue; // Skip users already in room
  }
  
  availableUsers.push(user);
  if (availableUsers.length >= maxUsersToInvite) {
    break;
  }
}
```
**Purpose**: Filter online users who are available for auto-invite
**Context**: `autostartgame` method

### Line 4906 - Map User IDs for Invites
```typescript
const userIdsToInvite = availableUsers
  .map((u) => this.normalizeId(u._id))
  .filter((id): id is string => id !== null);
```
**Purpose**: Extract and normalize user IDs from available users
**Context**: `autostartgame` method

---

## 3. Traditional for Loops (2 instances - NESTED)

### Line 2918 - Process Daily Streak Updates (Outer Loop)
```typescript
for (let i = 0; i < players.length; i++) {
  const playerId = players[i];
  const streakUpdate = streakUpdates[i];
  if (streakUpdate) {
    playerDailyStreaks[playerId] = {
      currentDailyStreak: streakUpdate.currentDailyStreak || 0,
      longestDailyStreak: streakUpdate.longestDailyStreak || 0,
      dailyStreakIcons: streakUpdate.dailyStreakIcons || [],
    };
  } else {
    playersNeedingFallback.push(playerId);
  }
}
```
**Purpose**: Process daily streak updates for all players
**Context**: `endMultiplayerGame` method

### Line 2941 - Map Fallback Streak Results (Inner Loop)
```typescript
for (let j = 0; j < playersNeedingFallback.length; j++) {
  const playerId = playersNeedingFallback[j];
  playerDailyStreaks[playerId] = fallbackStreaks[j];
}
```
**Purpose**: Map fallback streak results for players who didn't get updates
**Context**: `endMultiplayerGame` method - nested inside streak processing

**Note**: This is the only nested loop structure in the file (2 levels deep)

---

## 4. Array Methods - Map/Filter (25+ instances)

### Data Normalization Patterns (15+ instances)

**Pattern**: Normalize IDs from arrays
```typescript
.map((id) => this.normalizeId(id))
.filter((id): id is string => !!id);
```

**Locations**:
- Line 932-933: Normalize subtopic IDs (createGame)
- Line 1077-1078: Normalize participant IDs (createGame)
- Line 1352-1353: Normalize room participants (restartGame)
- Line 1394: Normalize eliminated players from DB
- Line 1398: Normalize eliminated players from state
- Line 1505-1506: Normalize subtopic IDs (restartGame)
- Line 1597-1598: Normalize participant IDs (restartGame)
- Line 1880-1881: Normalize subtopic IDs (startGame)
- Line 2949-2950: Normalize player IDs (endMultiplayerGame)
- Line 3030-3031: Normalize player IDs (endMultiplayerGame - skip path)
- Line 3336: Normalize user IDs for invites
- Line 3549-3550: Normalize subtopic IDs (auto-start)
- Line 3630-3631: Normalize participant IDs (auto-start)
- Line 3791-3792: Normalize participant IDs (acceptInvite)
- Line 4906-4907: Normalize user IDs (autostartgame)

### Map Creation Patterns (6+ instances)

**Pattern**: Create Maps from arrays for O(1) lookup
```typescript
const usersMap = new Map(allUsers.map(u => [this.normalizeId(u._id) || '', u]));
const progressMap = new Map(
  allGameProgress.map(gp => [this.normalizeId(gp.userId) || '', gp])
);
```

**Locations**:
- Line 1096-1098: Create users and progress maps (createGame)
- Line 1616-1618: Create users and progress maps (restartGame)
- Line 2961: Create users map (endMultiplayerGame)
- Line 3042: Create users map (endMultiplayerGame - skip path)
- Line 3649-3651: Create users and progress maps (auto-start)
- Line 3803: Create users map (acceptInvite)

### Filtering Patterns (8+ instances)

**Pattern**: Filter active/eliminated/remaining players
```typescript
const activePlayers = gameState.players.filter(
  (p) => !gameState.eliminatedPlayers.has(p)
);
```

**Locations**:
- Line 371: Filter remaining players (handleDisconnect)
- Line 2367: Filter active players (handleMultiplayerAnswer)
- Line 2384: Filter active players (handleMultiplayerAnswer)
- Line 2415: Filter active players (handleMultiplayerAnswer)
- Line 2481: Filter active players (handleMultiplayerQuestionTimeout)
- Line 2541: Filter active players (handleMultiplayerQuestionTimeout)
- Line 2608: Filter remaining active players (handleMultiplayerQuestionTimeout)
- Line 2696: Filter players when removing (removePlayerFromGame)
- Line 2752: Filter correct answers (endMultiplayerGame)
- Line 2768: Filter winners (endMultiplayerGame)
- Line 4095: Filter remaining players (leaveUser)
- Line 4239: Filter remaining players (removeUserFromRoom)
- Line 1792: Filter included eliminated players (restartGame)

### Data Transformation Patterns (5+ instances)

**Pattern**: Transform data for database/response
```typescript
players.map((playerId) =>
  this.contentService.incrementTotalGamesPlayed(playerId)
);
```

**Locations**:
- Line 2900: Map players for total games increment
- Line 2907: Map players for streak updates
- Line 2935: Map players for fallback streaks
- Line 2965: Map players for gameOver emission
- Line 3046: Map players for gameOver emission (skip path)
- Line 2870: Map answers for database
- Line 3143: Map answers for database (single player)

---

## Performance Analysis

### Time Complexity
- **Most loops**: O(n) where n = number of players (typically 2-6)
- **Nested loops (lines 2918-2945)**: O(n × m) where n = players, m = fallback players
- **Filter operations**: O(n) - linear scan
- **Map operations**: O(n) - linear transformation

### Optimization Opportunities

1. **Batch Operations**: Already implemented in most places (lines 1084-1093, 1604-1613)
2. **Map Lookups**: Using Maps for O(1) lookups instead of array searches
3. **Early Exit**: Some loops use `break` when max users reached (line 4857)

### Most Expensive Operations

1. **Line 2918-2945**: Nested loops for streak processing (only nested loop)
2. **Line 1102-1193**: Complex forEach with multiple database-like operations
3. **Line 4835**: Filtering online users (could be expensive with many users)

---

## Loop Categories by Purpose

### 1. Initialization Loops (5 instances)
- Initialize player scores, answers, wrong answers
- Lines: 1011, 1561, 1937, 3600

### 2. Data Processing Loops (8 instances)
- Process player information (coins, points, level, winner rate)
- Lines: 1102, 1622, 3655, 3812, 2750, 2867, 2882

### 3. Socket Management Loops (4 instances)
- Join participants to rooms
- Lines: 1032, 1723, 3450

### 4. Game Logic Loops (6 instances)
- Handle answers, timeouts, win/loss determination
- Lines: 2432, 2485, 2585, 2783

### 5. Invite Management Loops (3 instances)
- Send invites, process auto-invites
- Lines: 3358, 4835, 4906

### 6. Cleanup Loops (2 instances)
- Clear timeouts, process eliminated players
- Lines: 460, 3515, 1419

### 7. Data Normalization Loops (15+ instances)
- Normalize IDs, create maps, filter arrays
- Lines: Various map/filter operations

---

## Recommendations

1. **Consider using Promise.all()** for parallel async operations in loops
2. **Cache normalized IDs** to avoid repeated normalization
3. **Use Set operations** for faster lookups when checking membership
4. **Consider pagination** for online users list if it grows large
5. **Monitor nested loop** at lines 2918-2945 for performance with many players

---

## File Statistics

- **Total Lines**: 5,182
- **Total Loops**: ~50+
- **Nested Loops**: 1 (2 levels deep)
- **Most Common Pattern**: forEach (18 instances)
- **Most Complex Loop**: Lines 2918-2945 (nested for loops)

---

*Generated: Loop Analysis for game.gateway.ts*

