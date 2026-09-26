export let myPlayerId = "";
if (typeof window !== "undefined") {
  myPlayerId = localStorage.getItem("myPlayerId") || "";
  if (!myPlayerId) {
    myPlayerId = Math.random().toString(36).substring(2, 10);
    localStorage.setItem("myPlayerId", myPlayerId);
  }
}
