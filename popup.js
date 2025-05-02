document.addEventListener("DOMContentLoaded", async () => {
    const loader = document.querySelector(".loader")
    const currentSite = document.querySelector(".current-site")
    const recordBoxes = document.querySelectorAll(".record-box")
    const tabs = document.querySelectorAll(".tab")
    const themeToggle = document.getElementById("theme-toggle")
    const countElements = {
      a: document.getElementById("a-count"),
      www: document.getElementById("www-count"),
      ns: document.getElementById("ns-count"),
      mx: document.getElementById("mx-count"),
      txt: document.getElementById("txt-count"),
    }
  
    // Theme management
    function setTheme(isDark) {
      if (isDark) {
        document.body.classList.add("dark-theme")
        themeToggle.textContent = "🌙"
        localStorage.setItem("dnsRecordsTheme", "dark")
      } else {
        document.body.classList.remove("dark-theme")
        themeToggle.textContent = "☀️"
        localStorage.setItem("dnsRecordsTheme", "light")
      }
    }
  
    // Check for saved theme preference or use system preference
    const savedTheme = localStorage.getItem("dnsRecordsTheme")
    if (savedTheme) {
      setTheme(savedTheme === "dark")
    } else {
      // Check if user prefers dark mode
      const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      setTheme(prefersDark)
    }
  
    // Theme toggle button
    themeToggle.addEventListener("click", () => {
      const isDark = document.body.classList.contains("dark-theme")
      setTheme(!isDark)
    })
  
    // Tab switching functionality
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        // Remove active class from all tabs and record boxes
        tabs.forEach((t) => t.classList.remove("active"))
        recordBoxes.forEach((box) => box.classList.remove("active"))
  
        // Add active class to clicked tab
        tab.classList.add("active")
  
        // Show corresponding record box
        const tabName = tab.getAttribute("data-tab")
        let recordBox
  
        switch (tabName) {
          case "a":
            recordBox = document.getElementById("a-records")
            break
          case "www":
            recordBox = document.getElementById("www-records")
            break
          case "ns":
            recordBox = document.getElementById("ns-records")
            break
          case "mx":
            recordBox = document.getElementById("mx-records")
            break
          case "txt":
            recordBox = document.getElementById("txt-records")
            break
        }
  
        if (recordBox) {
          recordBox.classList.add("active")
        }
      })
    })
  
    try {
      // Check if chrome is defined, if not, mock it for testing/non-extension environments
      if (typeof chrome === "undefined" || !chrome.tabs) {
        console.warn("Chrome API not available. Using mock implementation.")
        window.chrome = {
          tabs: {
            query: (options) => {
              return new Promise((resolve) => {
                // Mock implementation: return a default tab object
                resolve([{ url: "https://example.com" }])
              })
            },
          },
        }
      }
  
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      const url = new URL(tab.url)
  
      // Extract the hostname and remove 'www.' if present
      let hostname = url.hostname
      const displayHostname = hostname // Keep the original hostname for display
  
      // Strip 'www.' prefix for DNS queries to always query the root domain
      if (hostname.startsWith("www.")) {
        hostname = hostname.substring(4)
      }
  
      // Display the original hostname in the UI
      currentSite.textContent = displayHostname
  
      async function fetchDNSRecords(recordType) {
        try {
          // First try with default DNS settings
          let response = await fetch(`https://dns.google/resolve?name=${hostname}&type=${recordType}`)
          let data = await response.json()
  
          // Check for all Turkish domain extensions
          const trDomains = [".tr", ".com.tr", ".net.tr", ".org.tr", ".web.tr", ".gen.tr", ".av.tr"]
          const isTrDomain = trDomains.some((ext) => hostname.toLowerCase().endsWith(ext))
  
          // If no answer and it's a Turkish domain, try with specific settings
          if ((!data.Answer || data.Answer.length === 0) && isTrDomain) {
            response = await fetch(`https://dns.google/resolve?name=${hostname}&type=${recordType}&cd=true&do=true`)
            data = await response.json()
  
            // If still no answer, try with nameserver for .tr domains
            if (!data.Answer || data.Answer.length === 0) {
              response = await fetch(
                `https://dns.google/resolve?name=${hostname}&type=${recordType}&cd=true&do=true&edns_client_subnet=0.0.0.0/0`,
              )
              data = await response.json()
            }
          }
  
          return data.Answer || []
        } catch (error) {
          console.error(`Error fetching ${recordType} records:`, error)
          return []
        }
      }
  
      // Special function to fetch WWW record (CNAME for www.domain.com)
      async function fetchWWWRecord() {
        try {
          // For WWW records, we specifically query for www.hostname
          const wwwHostname = `www.${hostname}`
          let response = await fetch(`https://dns.google/resolve?name=${wwwHostname}&type=CNAME`)
          let data = await response.json()
  
          // If no CNAME record, try A record (some sites use A records for www)
          if (!data.Answer || data.Answer.length === 0) {
            response = await fetch(`https://dns.google/resolve?name=${wwwHostname}&type=A`)
            data = await response.json()
          }
  
          return data.Answer || []
        } catch (error) {
          console.error("Error fetching WWW record:", error)
          return []
        }
      }
  
      // Update the displayRecords function to handle TXT records differently
      function displayRecords(records, type, countElement) {
        let contentElement
  
        switch (type) {
          case "A":
            contentElement = document.querySelector("#a-records .record-content")
            if (countElement) countElement.textContent = records.length
            break
          case "WWW":
            contentElement = document.querySelector("#www-records .record-content")
            if (countElement) countElement.textContent = records.length
            break
          case "NS":
            contentElement = document.querySelector("#ns-records .record-content")
            if (countElement) countElement.textContent = records.length
            break
          case "MX":
            contentElement = document.querySelector("#mx-records .record-content")
            if (countElement) countElement.textContent = records.length
            break
          case "TXT":
            contentElement = document.querySelector("#txt-records .record-content")
            if (countElement) countElement.textContent = records.length
            break
        }
  
        if (!contentElement || !records.length) {
          if (contentElement) contentElement.innerHTML = ""
          return
        }
  
        contentElement.innerHTML = records
          .map((record) => {
            let data = record.data
  
            if (type === "MX") {
              const [priority, server] = data.split(" ")
              data = `${server} (${priority})`
            }
  
            // Format TXT records for better display
            if (type === "TXT") {
              // Remove quotes if they exist at the beginning and end
              if (data.startsWith('"') && data.endsWith('"')) {
                data = data.substring(1, data.length - 1)
              }
            }
  
            return `<div class="record-item">
                      <div class="record-data">${data}</div>
                      <div class="ttl">TTL: ${record.TTL}s</div>
                    </div>`
          })
          .join("")
      }
  
      // Fetch and display records
      const aRecords = await fetchDNSRecords("A")
      displayRecords(aRecords, "A", countElements.a)
  
      const wwwRecords = await fetchWWWRecord()
      displayRecords(wwwRecords, "WWW", countElements.www)
  
      const nsRecords = await fetchDNSRecords("NS")
      displayRecords(nsRecords, "NS", countElements.ns)
  
      const mxRecords = await fetchDNSRecords("MX")
      displayRecords(mxRecords, "MX", countElements.mx)
  
      const txtRecords = await fetchDNSRecords("TXT")
      displayRecords(txtRecords, "TXT", countElements.txt)
    } catch (error) {
      console.error("Error:", error)
    } finally {
      loader.style.display = "none"
    }
  })
  