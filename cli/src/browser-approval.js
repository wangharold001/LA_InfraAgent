import fs from "fs";
import path from "path";

/**
 * Wait for user to approve the diagram in the browser
 * @param {string} approvalFilePath - Path to the approval file
 * @param {number} timeoutMs - Max time to wait (default: 30 minutes)
 * @returns {Promise<object>} - The approved diagram state
 */
export async function waitForBrowserApproval(approvalFilePath, timeoutMs = 30 * 60 * 1000) {
  const projectDir = path.dirname(approvalFilePath);
  const fileName = path.basename(approvalFilePath);

  console.log("\n" + "=".repeat(80));
  console.log("📋 REVIEW YOUR ARCHITECTURE IN THE BROWSER");
  console.log("=".repeat(80));
  console.log("\nThe diagram has been opened in your browser.");
  console.log("\n👉 Steps to approve:");
  console.log("   1. Review the architecture diagram");
  console.log("   2. Edit nodes/edges if you want to make changes");
  console.log("   3. Click '✅ Approve & Generate CDK' button");
  console.log(`   4. Save the downloaded file to: ${projectDir}/`);
  console.log(`      (File will be named: ${fileName})`);
  console.log("\n⏱️  Waiting for your approval...");
  console.log(`   (Times out in ${timeoutMs / 60000} minutes)`);
  console.log("\n   💡 Tip: Any edits you make will be used for CDK generation!");
  console.log("=".repeat(80));

  const startTime = Date.now();
  const pollInterval = 1000; // Check every second

  return new Promise((resolve, reject) => {
    const checkForApproval = () => {
      // Check if approval file exists
      if (fs.existsSync(approvalFilePath)) {
        try {
          // Read and parse the approved state
          const approvedState = JSON.parse(fs.readFileSync(approvalFilePath, "utf8"));

          // Clean up the approval file
          fs.unlinkSync(approvalFilePath);

          console.log("\n✅ Architecture approved!");
          console.log(`   Resources: ${approvedState.nodes?.length || 0} nodes`);
          console.log(`   Connections: ${approvedState.edges?.length || 0} edges`);

          resolve(approvedState);
        } catch (error) {
          console.error("\n❌ Error reading approval file:");
          console.error(error.message);
          reject(new Error("Failed to read approved diagram"));
        }
        return;
      }

      // Check for timeout
      if (Date.now() - startTime > timeoutMs) {
        console.error("\n\n❌ Approval timeout!");
        console.error("   You didn't approve the diagram in time.");
        console.error("\n   Please run the agent again when ready.");
        reject(new Error("Approval timeout"));
        return;
      }

      // Continue polling
      setTimeout(checkForApproval, pollInterval);
    };

    // Start checking
    checkForApproval();
  });
}

/**
 * Inject approval UI into diagram HTML
 * @param {string} html - Original HTML content
 * @param {string} approvalFileName - Name of approval file to save
 * @returns {string} - Modified HTML with approval UI
 */
export function injectApprovalUI(html, approvalFileName) {
  // Add CSS for Generate CDK button in topbar
  const approvalCSS = `
<style id="approval-mode-css">
  #btnGenerateCDK {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    font-weight: 600;
    padding: 6px 16px;
    box-shadow: 0 2px 4px rgba(102, 126, 234, 0.3);
  }
  #btnGenerateCDK:hover {
    background: linear-gradient(135deg, #5568d3 0%, #6941a5 100%);
    box-shadow: 0 4px 8px rgba(102, 126, 234, 0.4);
  }
  #btnGenerateCDK.approved {
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    cursor: default;
  }
  #btnGenerateCDK.approved:hover {
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  }
</style>`;

  // Modify the topbar to add Generate CDK button after Save button
  const generateCDKButton = `<button id="btnGenerateCDK">✅ Generate CDK</button>`;

  // Add the button after the Save button in the topbar
  html = html.replace(
    '<button id="btnSave">Save</button>',
    '<button id="btnSave">Save</button>\n    ' + generateCDKButton
  );

  // Add approval JavaScript
  const approvalJS = `
<script id="approval-mode-js">
(function() {
  const generateBtn = document.getElementById('btnGenerateCDK');

  generateBtn.addEventListener('click', function() {
    if (generateBtn.classList.contains('approved')) {
      return; // Already approved
    }

    // Get current diagram state (with any edits!)
    const approvedState = state;

    // Save to file for the agent to pick up
    const blob = new Blob([JSON.stringify(approvedState, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "${approvalFileName}";
    a.click();
    URL.revokeObjectURL(url);

    // Update button state
    generateBtn.textContent = '✓ Approved! Return to Terminal';
    generateBtn.classList.add('approved');

    console.log('✅ Architecture approved!');
    console.log('📥 State saved: ${approvalFileName}');
    console.log('👉 Save the downloaded file to your project directory');
    console.log('👉 Return to your terminal - CDK generation will start automatically');
  });
})();
</script>`;

  // Inject CSS before </head>
  html = html.replace('</head>', `${approvalCSS}</head>`);

  // Inject JS before </body>
  html = html.replace('</body>', `${approvalJS}</body>`);

  return html;
}
