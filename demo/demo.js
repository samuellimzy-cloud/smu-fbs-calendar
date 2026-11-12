"use strict";

(() => {
  const body = document.getElementById("demo-bookings");
  const original = Array.from(body.rows, row => row.cloneNode(true));
  const message = document.getElementById("demo-message");
  const addButton = document.getElementById("demo-add");
  const cancelButton = document.getElementById("demo-cancel");

  function updateCount() {
    document.getElementById("demo-count").textContent = `${body.rows.length} ITEM(S) TOTAL`;
  }

  addButton.addEventListener("click", () => {
    if (document.getElementById("demo-extra-booking")) return;
    const row = document.createElement("tr");
    row.id = "demo-extra-booking";
    const fields = ["", "DEMO-005", "19-Nov-2026 (Thu)", "Li Ka Shing Library", "LKSLIB Project Room 4-2", "You", "AdHoc", "10.50", "Confirmed", "VIEW"];
    fields.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (index === 0) {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.setAttribute("aria-label", "Select DEMO-005");
        cell.append(checkbox);
      }
      if (index === 2) cell.append(document.createElement("br"), "09:00 - 11:00 (2hrs)");
      if (index === 8) cell.className = "status";
      if (index === 9) cell.className = "view";
      row.append(cell);
    });
    body.append(row);
    addButton.disabled = true;
    message.textContent = "Added a Thursday booking. The calendar can now read the updated table.";
    updateCount();
  });

  cancelButton.addEventListener("click", () => {
    const status = body.rows[0].cells[8];
    const isConfirmed = status.textContent === "Confirmed";
    status.textContent = isConfirmed ? "Cancelled" : "Confirmed";
    status.style.color = isConfirmed ? "#a64040" : "";
    cancelButton.textContent = isConfirmed ? "Restore first booking" : "Cancel first booking";
    message.textContent = isConfirmed ? "The Monday booking is cancelled. Confirmed-only exports exclude it." : "The Monday booking is confirmed again.";
  });

  document.getElementById("demo-reset").addEventListener("click", () => {
    body.replaceChildren(...original.map(row => row.cloneNode(true)));
    addButton.disabled = false;
    cancelButton.textContent = "Cancel first booking";
    message.textContent = "Reset to the original four sample bookings.";
    updateCount();
  });
})();
