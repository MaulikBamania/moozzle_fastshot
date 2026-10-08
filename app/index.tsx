import { Image, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Svg, { Path, SvgXml } from "react-native-svg";

// Open an external URL in a new browser tab (web) or the system handler (native).
// Safari blocks window.open navigations to sites that send a Cross-Origin-Opener-Policy
// header (e.g. x.com) with "Navigation was blocked by Cross-Origin-Opener-Policy".
// A synthetic anchor click with rel="noopener" navigates the new tab straight to the URL
// (no about:blank intermediate) while decoupling the opener, so COOP is never triggered.
const openExternalUrl = (url: string) => {
  // Web-only branch: `document` never runs on Hermes (FST-315 lint rule).
  // eslint-disable-next-line no-restricted-globals
  if (Platform.OS === "web" && typeof document !== "undefined") {
    // eslint-disable-next-line no-restricted-globals
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
    return;
  }
  Linking.openURL(url);
};

const PANDA_SIZE = 260;

// Body (single fill — off-white)
const svgBody = `<svg viewBox="0 0 218.063 247.993" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.77415 98.3996C3.42561 14.8914 90.9119 -22.7771 160.066 14.2259C207.322 39.5113 264.662 233.81 155.744 243.791C54.0296 253.112 71.3686 248.635 27.8086 212.85C-7.62035 167.714 -2.42489 142.814 6.77415 98.3996Z" fill="#EFEFEF"/></svg>`;

// Ears (fill-0 base + fill-1 black on top → renders black)
const svgEars = `<svg viewBox="0 0 160.362 43.2627" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M0.927081 18.0554C8.96318 2.21733 34.4412 -3.58093 43.0737 2.17404C55.9009 10.7255 46.1393 18.4581 50.4035 25.8211L16.1859 43.2627C8.57223 34.3673 -3.43071 26.6439 0.927081 18.0554Z" fill="#D0ACDC"/>
<path d="M0.927081 18.0554C8.96318 2.21733 34.4412 -3.58093 43.0737 2.17404C55.9009 10.7255 46.1393 18.4581 50.4035 25.8211L16.1859 43.2627C8.57223 34.3673 -3.43071 26.6439 0.927081 18.0554Z" fill="black"/>
<path d="M159.435 18.0553C151.399 2.21729 125.921 -3.58097 117.288 2.174C104.461 10.7254 114.223 18.458 109.959 25.821L144.176 43.2626C151.79 34.3672 163.793 26.6439 159.435 18.0553Z" fill="#D0ACDC"/>
<path d="M159.435 18.0553C151.399 2.21729 125.921 -3.58097 117.288 2.174C104.461 10.7254 114.223 18.458 109.959 25.821L144.176 43.2626C151.79 34.3672 163.793 26.6439 159.435 18.0553Z" fill="black"/>
</svg>`;

// Body belly mask (fill-0 base + fill-1 black → black belly shadow)
const svgBodyMask = `<svg viewBox="0 0 218.063 247.993" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m0" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="219" height="248"><path d="M6.77415 98.3996C3.42561 14.8914 90.9119 -22.7771 160.066 14.2259C207.322 39.5113 264.662 233.81 155.744 243.791C54.0296 253.112 71.3686 248.635 27.8086 212.85C-7.62035 167.714 -2.42489 142.814 6.77415 98.3996Z" fill="#F5EEF7"/></mask></defs><g mask="url(#m0)"><path d="M7.63532 46.6916C56.1955 73.5677 135.602 65.627 181.719 36.0022C285.559 146.255 -71.4659 145.339 7.63532 46.6916Z" fill="#D9D9D9"/><path d="M7.63532 46.6916C56.1955 73.5677 135.602 65.627 181.719 36.0022C285.559 146.255 -71.4659 145.339 7.63532 46.6916Z" fill="black"/></g></svg>`;

// Head (single fill — off-white)
const svgHead = `<svg viewBox="0 0 181.655 123.386" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16.4599 43.6158C22.8735 1.13287 71.1283 2.77147e-05 94.0341 0V119.235C88.8421 123.767 66.5346 123.598 59.2173 123.2C-3.39175 119.802 -14.0811 70.2384 16.4599 43.6158Z" fill="#EFEFEF"/><path d="M165.195 43.6158C158.781 1.13294 110.526 9.8443e-05 87.6205 7.07283e-05V119.235C92.8125 123.767 115.12 123.598 122.437 123.2C185.046 119.802 195.736 70.2385 165.195 43.6158Z" fill="#EFEFEF"/></svg>`;

// Cheeks (gradient only, no black overlay)
const svgCheeks = `<svg viewBox="0 0 80.6283 51.3089" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="cg0" x1="23.0224" y1="19.2883" x2="23.0224" y2="43.3655" gradientUnits="userSpaceOnUse"><stop stop-color="#EFEFEF"/><stop offset="1" stop-color="#DDD9DE"/></linearGradient><linearGradient id="cg1" x1="57.6059" y1="19.4975" x2="57.6059" y2="43.9569" gradientUnits="userSpaceOnUse"><stop stop-color="#EFEFEF"/><stop offset="1" stop-color="#DDD9DE"/></linearGradient></defs><path d="M12.0103 10.0975C21.0928 3.0475 37.7795 5.4052 40.3141 16.6667V36.1397C33.3438 47.1667 16.8684 45.9936 11.1654 40.5974C5.69853 35.4246 2.92767 17.1476 12.0103 10.0975Z" fill="url(#cg0)"/><path d="M68.6181 10.1609C59.5355 2.99891 42.8489 5.39402 40.3142 16.8343V36.6164C47.2846 47.8184 63.76 46.6267 69.463 41.1448C74.9298 35.89 77.7007 17.3228 68.6181 10.1609Z" fill="url(#cg1)"/></svg>`;

// Eye patches (fill-0 + fill-1 black → black eye patches)
const svgEyePatches = `<svg viewBox="0 0 123.114 38.3796" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M12.7791 12.6331C15.8332 6.83012 24.9955 -2.02677 39.0444 0.416521C57.0644 3.55044 46.0688 23.3222 34.7686 30.6521C21.0157 39.573 2.94371 42.9236 0.257268 28.8196C-1.89513 17.5195 10.0881 17.7461 12.7791 12.6331Z" fill="#D0ACDC"/>
<path d="M12.7791 12.6331C15.8332 6.83012 24.9955 -2.02677 39.0444 0.416521C57.0644 3.55044 46.0688 23.3222 34.7686 30.6521C21.0157 39.573 2.94371 42.9236 0.257268 28.8196C-1.89513 17.5195 10.0881 17.7461 12.7791 12.6331Z" fill="black"/>
<path d="M110.335 12.6331C107.28 6.83017 98.1181 -2.02672 84.0693 0.416569C66.0493 3.55049 77.0448 23.3223 88.345 30.6522C102.098 39.5731 120.17 42.9236 122.856 28.8197C125.009 17.5195 113.026 17.7462 110.335 12.6331Z" fill="#D0ACDC"/>
<path d="M110.335 12.6331C107.28 6.83017 98.1181 -2.02672 84.0693 0.416569C66.0493 3.55049 77.0448 23.3223 88.345 30.6522C102.098 39.5731 120.17 42.9236 122.856 28.8197C125.009 17.5195 113.026 17.7462 110.335 12.6331Z" fill="black"/>
</svg>`;

// Nose (fill-0 + fill-1 black → black nose)
const svgNose = `<svg viewBox="0 0 24.8666 16.4923" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M2.04936 2.74869C4.99437 4.77669e-05 8.463 -4.45811e-05 12.4333 3.56803e-07L12.4333 16.4921C8.46298 16.4921 6.3251 14.9651 6.3251 11.911C2.04938 12.8272 -2.85907 7.32984 2.04936 2.74869Z" fill="#D0ACDC"/>
<path d="M2.04936 2.74869C4.99437 4.77669e-05 8.463 -4.45811e-05 12.4333 3.56803e-07L12.4333 16.4921C8.46298 16.4921 6.3251 14.9651 6.3251 11.911C2.04938 12.8272 -2.85907 7.32984 2.04936 2.74869Z" fill="black"/>
<path d="M22.8172 2.74881C19.8722 0.000168772 16.4036 7.6424e-05 12.4333 0.000121362L12.4333 16.4923C16.4036 16.4923 18.5415 14.9652 18.5415 11.9111C22.8172 12.8273 27.7257 7.32996 22.8172 2.74881Z" fill="#D0ACDC"/>
<path d="M22.8172 2.74881C19.8722 0.000168772 16.4036 7.6424e-05 12.4333 0.000121362L12.4333 16.4923C16.4036 16.4923 18.5415 14.9652 18.5415 11.9111C22.8172 12.8273 27.7257 7.32996 22.8172 2.74881Z" fill="black"/>
</svg>`;

// Feet back (fill-0 white + fill-1 black → black feet)
const svgFeetBack = `<svg viewBox="0 0 161.987 98.3274" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M56.4762 48.1948C77.8549 35.673 103.638 -4.58145 136.494 8.79675C187.497 29.5646 125.809 82.6858 89.5051 88.283C66.2493 91.8685 16.6172 97.9071 7.61056 79.9575C-2.95133 58.9085 45.2454 54.7729 56.4762 48.1948Z" fill="white"/>
<path d="M56.4762 48.1948C77.8549 35.673 103.638 -4.58145 136.494 8.79675C187.497 29.5646 125.809 82.6858 89.5051 88.283C66.2493 91.8685 16.6172 97.9071 7.61056 79.9575C-2.95133 58.9085 45.2454 54.7729 56.4762 48.1948Z" fill="black"/>
</svg>`;

// Feet front (fill-0 + fill-1 black → black feet)
const svgFeetFront = `<svg viewBox="0 0 190.481 134.124" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M70.5009 64.1658C81.086 41.7649 84.6473 -7.14841 150.824 9.4973C200.606 22.0192 187.497 72.8537 159.681 96.8448C100.431 147.946 0.382659 127.646 6.36472 96.8448C11.8621 68.5391 57.3682 91.958 70.5009 64.1658Z" fill="#D0ACDC"/>
<path d="M70.5009 64.1658C81.086 41.7649 84.6473 -7.14841 150.824 9.4973C200.606 22.0192 187.497 72.8537 159.681 96.8448C100.431 147.946 0.382659 127.646 6.36472 96.8448C11.8621 68.5391 57.3682 91.958 70.5009 64.1658Z" fill="black"/>
</svg>`;

const X_PATH = "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z";
const LINKEDIN_PATH = "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z";

export default function Index() {
  return (
    <View style={styles.container}>
      <View style={styles.panda}>
        <View style={[styles.layer, { left: "37.7%", top: "19.6%", width: "62.3%", height: "71.4%" }]}>
          <SvgXml xml={svgBody} width="100%" height="100%" />
        </View>
        <View style={[styles.layer, { left: "40.8%", top: "0%", width: "45.8%", height: "12.45%" }]}>
          <SvgXml xml={svgEars} width="100%" height="100%" />
        </View>
        <View style={[styles.layer, { left: "37.7%", top: "19.6%", width: "62.3%", height: "71.4%" }]}>
          <SvgXml xml={svgBodyMask} width="100%" height="100%" />
        </View>
        <View style={[styles.layer, { left: "37.7%", top: "5.2%", width: "51.9%", height: "35.5%" }]}>
          <SvgXml xml={svgHead} width="100%" height="100%" />
        </View>
        <View style={[styles.layer, { left: "53.8%", top: "23.48%", width: "19.5%", height: "11.25%" }]}>
          <SvgXml xml={svgCheeks} width="100%" height="100%" />
        </View>
        <View style={[styles.layer, { left: "45.9%", top: "14.16%", width: "35.2%", height: "11.04%" }]}>
          <SvgXml xml={svgEyePatches} width="100%" height="100%" />
        </View>
        <View style={[styles.layer, { left: "60%", top: "26.65%", width: "7.1%", height: "4.74%" }]}>
          <SvgXml xml={svgNose} width="100%" height="100%" />
        </View>
        <View style={[styles.layer, { left: "0%", top: "32.86%", width: "66.7%", height: "67.1%" }]}>
          <Image
            source={require("../assets/images/panda-eye.png")}
            style={{ width: "100%", height: "100%" }}
            resizeMode="contain"
          />
        </View>
        <View style={[styles.layer, { left: "51.8%", top: "39.02%", width: "42.8%", height: "24.78%" }]}>
          <SvgXml xml={svgFeetBack} width="100%" height="100%" />
        </View>
        <View style={[styles.layer, { left: "45.8%", top: "64.06%", width: "50.9%", height: "35.07%" }]}>
          <SvgXml xml={svgFeetFront} width="100%" height="100%" />
        </View>
      </View>

      <Text style={styles.followText}>✦ follow us ✦</Text>

      <View style={styles.social}>
        <TouchableOpacity
          onPress={() => openExternalUrl("https://x.com/fastshot_ai")}
          style={styles.iconBtn}
          activeOpacity={0.65}
        >
          <Svg width={22} height={22} viewBox="0 0 24 24">
            <Path d={X_PATH} fill="#111111" />
          </Svg>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => openExternalUrl("https://www.linkedin.com/company/fastshot")}
          style={styles.iconBtn}
          activeOpacity={0.65}
        >
          <Svg width={22} height={22} viewBox="0 0 24 24">
            <Path d={LINKEDIN_PATH} fill="#0A66C2" />
          </Svg>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  panda: {
    width: PANDA_SIZE,
    height: PANDA_SIZE,
    position: "relative",
  },
  layer: {
    position: "absolute",
  },
  followText: {
    fontFamily: "Inter_600SemiBold",
    fontStyle: "italic",
    fontSize: 13,
    letterSpacing: 3,
    color: "#B09BC0",
    marginTop: 28,
    marginBottom: 14,
    textTransform: "lowercase",
  },
  social: {
    flexDirection: "row",
    gap: 8,
  },
  iconBtn: {
    padding: 10,
  },
});
