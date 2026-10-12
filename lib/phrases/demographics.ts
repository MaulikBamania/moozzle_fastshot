/** Register Animal demographics: species, dairy society, age group, Status I / II, registration time and GPS. Format: English | Hindi | Gujarati */
export const DEMOGRAPHICS = `
{x} * | {x} * | {x} *
CATTLE | गाय (CATTLE) | ગાય (CATTLE)
BUFFALO | भैंस (BUFFALO) | ભેંસ (BUFFALO)
BULLOCK | बैल (BULLOCK) | બળદ (BULLOCK)
CROSSBREED | संकर नस्ल (CROSSBREED) | સંકર ઓલાદ (CROSSBREED)
Bullock | बैल | બળદ
Crossbreed | संकर नस्ल | સંકર ઓલાદ
Crossbred | संकर नस्ल | સંકર ઓલાદ
Bull | साँड | આખલો
A bull is always male | साँड हमेशा नर होता है | આખલો હંમેશાં નર હોય છે
Set to NA: bulls do not produce milk. | NA पर सेट: साँड दूध नहीं देते। | NA પર સેટ: આખલા દૂધ આપતા નથી.
Set to NA: bulls cannot be pregnant. | NA पर सेट: साँड गर्भवती नहीं हो सकते। | NA પર સેટ: આખલા ગાભણા ન હોઈ શકે.
A bull or bullock is always male; set sex to Male. | साँड या बैल हमेशा नर होता है; लिंग नर चुनें। | આખલો અથવા બળદ હંમેશાં નર હોય છે; જાતિ નર પસંદ કરો.
Choose the bovine species (Cattle, Buffalo, Crossbred, Bull or Bullock). | गोवंश प्रजाति चुनें (गाय, भैंस, संकर नस्ल, साँड या बैल)। | ગોવંશ પ્રજાતિ પસંદ કરો (ગાય, ભેંસ, સંકર ઓલાદ, આખલો અથવા બળદ).
Status II must be NA for males, bulls, bullocks and calves. | नर, साँड, बैल और बछड़ों के लिए स्थिति II NA होनी चाहिए। | નર, આખલા, બળદ અને વાછરડાં માટે સ્થિતિ II NA હોવી જોઈએ.
Animal category | पशु श्रेणी | પશુ શ્રેણી
YES | हाँ (YES) | હા (YES)
NO | नहीं (NO) | ના (NO)
DRY | सूखी (DRY) | વસૂકેલી (DRY)
MILK | दुधारू (MILK) | દૂઝણી (MILK)
NA | लागू नहीं (NA) | લાગુ નથી (NA)
PREGNANT | गर्भवती (PREGNANT) | ગાભણી (PREGNANT)
NON-PREGNANT | गर्भवती नहीं (NON-PREGNANT) | ગાભણી નથી (NON-PREGNANT)
CALF | बछड़ा (CALF) | વાછરડું (CALF)
YOUNG | युवा (YOUNG) | યુવાન (YOUNG)
ADULT | वयस्क (ADULT) | પુખ્ત (ADULT)
Bovine Species | गोवंश प्रजाति | ગોવંશ પ્રજાતિ
Choose the bovine species first | पहले गोवंश प्रजाति चुनें | પહેલાં ગોવંશ પ્રજાતિ પસંદ કરો
A bullock is always male | बैल हमेशा नर होता है | બળદ હંમેશાં નર હોય છે
Age Group | आयु वर्ग | ઉંમર જૂથ
Age group | आयु वर्ग | ઉંમર જૂથ
Calculated automatically — not editable | स्वचालित रूप से गणना — बदला नहीं जा सकता | આપમેળે ગણતરી — બદલી શકાતું નથી
Not available | उपलब्ध नहीं | ઉપલબ્ધ નથી
Choose species first | पहले प्रजाति चुनें | પહેલાં પ્રજાતિ પસંદ કરો
Under {n} months | {n} महीने से कम | {n} મહિનાથી ઓછું
{n}–{n} months | {n}–{n} महीने | {n}–{n} મહિના
{n} months and older | {n} महीने और अधिक | {n} મહિના અને વધુ
Set the identity details before capturing the muzzle pattern. Fields marked * are mandatory. | थूथन पैटर्न कैप्चर करने से पहले पहचान विवरण भरें। * वाले फ़ील्ड अनिवार्य हैं। | નસકોરાની પેટર્ન કેપ્ચર કરતાં પહેલાં ઓળખ વિગતો ભરો. * વાળા ફીલ્ડ ફરજિયાત છે.
Are you giving milk in a dairy society? | क्या आप डेयरी सहकारी समिति में दूध देते हैं? | શું તમે દૂધ મંડળીમાં દૂધ ભરો છો?
Society Name | समिति का नाम | મંડળીનું નામ
Society Code | समिति कोड | મંડળી કોડ
Member Code | सदस्य कोड | સભાસદ કોડ
Society name | समिति का नाम | મંડળીનું નામ
Society code | समिति कोड | મંડળી કોડ
Member code | सदस्य कोड | સભાસદ કોડ
e.g. Shree Dashela Dudh Utpadak Mandali | जैसे श्री दशेला दूध उत्पादक मंडली | દા.ત. શ્રી દશેલા દૂધ ઉત્પાદક મંડળી
Code issued by the dairy union | डेयरी संघ द्वारा जारी कोड | દૂધ સંઘ દ્વારા આપેલ કોડ
Your member number at the society | समिति में आपका सदस्य नंबर | મંડળીમાં તમારો સભાસદ નંબર
Status I — Production | स्थिति I — उत्पादन | સ્થિતિ I — ઉત્પાદન
Status II — Pregnancy | स्थिति II — गर्भावस्था | સ્થિતિ II — ગર્ભાવસ્થા
Status I | स्थिति I | સ્થિતિ I
Status II | स्थिति II | સ્થિતિ II
MILK: producing milk now · DRY: dairy animal not producing now · NA: not applicable | दुधारू: अभी दूध दे रही है · सूखी: दुधारू पशु जो अभी दूध नहीं दे रहा · NA: लागू नहीं | દૂઝણી: હાલ દૂધ આપે છે · વસૂકેલી: દૂધાળું પશુ જે હાલ દૂધ આપતું નથી · NA: લાગુ નથી
PREGNANT: confirmed pregnant · NON-PREGNANT: confirmed not pregnant · NA: not applicable | गर्भवती: पुष्टि हुई गर्भवती · गर्भवती नहीं: पुष्टि हुई गर्भवती नहीं · NA: लागू नहीं | ગાભણી: ખાતરીપૂર્વક ગાભણી · ગાભણી નથી: ખાતરીપૂર્વક ગાભણી નથી · NA: લાગુ નથી
Set to NA: a bullock is a male draught animal. | NA पर सेट: बैल नर भारवाही पशु है। | NA પર સેટ: બળદ નર ખેતીકામનું પશુ છે.
Set to NA: males do not produce milk. | NA पर सेट: नर दूध नहीं देते। | NA પર સેટ: નર દૂધ આપતા નથી.
Set to NA: calves are not in milk production. | NA पर सेट: बछड़े दूध उत्पादन में नहीं होते। | NA પર સેટ: વાછરડાં દૂધ ઉત્પાદનમાં નથી.
Set to NA: only adult females can be MILK or DRY. | NA पर सेट: केवल वयस्क मादा ही दुधारू या सूखी हो सकती है। | NA પર સેટ: માત્ર પુખ્ત માદા જ દૂઝણી કે વસૂકેલી હોઈ શકે.
Set to NA: a bullock cannot be pregnant. | NA पर सेट: बैल गर्भवती नहीं हो सकता। | NA પર સેટ: બળદ ગાભણો ન હોઈ શકે.
Set to NA: males cannot be pregnant. | NA पर सेट: नर गर्भवती नहीं हो सकते। | NA પર સેટ: નર ગાભણા ન હોઈ શકે.
Set to NA: calves cannot be pregnant. | NA पर सेट: बछड़े गर्भवती नहीं हो सकते। | NA પર સેટ: વાછરડાં ગાભણાં ન હોઈ શકે.
Registration Date and Time | पंजीकरण तिथि और समय | નોંધણી તારીખ અને સમય
Captured automatically from this device when you submit; the server time is also recorded | जमा करते समय इस डिवाइस से अपने आप दर्ज; सर्वर समय भी दर्ज होता है | સબમિટ કરતી વખતે આ ઉપકરણમાંથી આપમેળે નોંધાય છે; સર્વર સમય પણ નોંધાય છે
Device local time · {x} | डिवाइस का स्थानीय समय · {x} | ઉપકરણનો સ્થાનિક સમય · {x}
GPS Latitude and Longitude | GPS अक्षांश और देशांतर | GPS અક્ષાંશ અને રેખાંશ
Compulsory · taken from the phone's location services, never typed in | अनिवार्य · फ़ोन की लोकेशन सेवा से लिया जाता है, हाथ से नहीं लिखा जाता | ફરજિયાત · ફોનની લોકેશન સેવામાંથી લેવાય છે, હાથથી લખાતું નથી
GPS not captured yet | GPS अभी कैप्चर नहीं हुआ | GPS હજી કેપ્ચર થયું નથી
Getting GPS position… | GPS स्थिति प्राप्त हो रही है… | GPS સ્થાન મેળવી રહ્યા છીએ…
GPS location captured | GPS लोकेशन कैप्चर हुई | GPS લોકેશન કેપ્ચર થયું
Location permission needed | लोकेशन अनुमति आवश्यक | લોકેશન પરવાનગી જરૂરી
Location permission blocked | लोकेशन अनुमति अवरुद्ध है | લોકેશન પરવાનગી અવરોધિત છે
Location services are off | लोकेशन सेवाएँ बंद हैं | લોકેશન સેવાઓ બંધ છે
GPS position not available | GPS स्थिति उपलब्ध नहीं | GPS સ્થાન ઉપલબ્ધ નથી
Latitude | अक्षांश | અક્ષાંશ
Longitude | देशांतर | રેખાંશ
Captured at | कैप्चर समय | કેપ્ચર સમય
Not reported | सूचित नहीं | જણાવ્યું નથી
Stand next to the animal and tap Capture GPS. Allow location access when the phone asks — registration cannot continue without it. | पशु के पास खड़े होकर GPS कैप्चर करें दबाएँ। फ़ोन पूछे तो लोकेशन की अनुमति दें — इसके बिना पंजीकरण आगे नहीं बढ़ेगा। | પશુની પાસે ઊભા રહી GPS કેપ્ચર કરો દબાવો. ફોન પૂછે ત્યારે લોકેશનની પરવાનગી આપો — તેના વિના નોંધણી આગળ નહીં વધે.
Keep the phone still with a clear view of the sky. This can take up to 30 seconds. | फ़ोन को स्थिर रखें और आकाश साफ़ दिखे। इसमें 30 सेकंड तक लग सकते हैं। | ફોન સ્થિર રાખો અને આકાશ ખુલ્લું દેખાય. તેમાં 30 સેકન્ડ સુધી લાગી શકે.
Android: swipe down from the top of the screen and turn on Location. iPhone: Settings → Privacy & Security → Location Services. | Android: स्क्रीन के ऊपर से नीचे स्वाइप करें और लोकेशन चालू करें। iPhone: सेटिंग्स → गोपनीयता और सुरक्षा → लोकेशन सेवाएँ। | Android: સ્ક્રીનની ઉપરથી નીચે સ્વાઇપ કરો અને લોકેશન ચાલુ કરો. iPhone: સેટિંગ્સ → ગોપનીયતા અને સુરક્ષા → લોકેશન સેવાઓ.
Capture the GPS location to continue. | आगे बढ़ने के लिए GPS लोकेशन कैप्चर करें। | આગળ વધવા માટે GPS લોકેશન કેપ્ચર કરો.
Capturing… | कैप्चर हो रहा है… | કેપ્ચર થઈ રહ્યું છે…
Capture GPS | GPS कैप्चर करें | GPS કેપ્ચર કરો
Recapture GPS | GPS फिर से कैप्चर करें | GPS ફરી કેપ્ચર કરો
Retry / Capture GPS | फिर प्रयास / GPS कैप्चर करें | ફરી પ્રયાસ / GPS કેપ્ચર કરો
Location permission was declined. GPS is compulsory for registration — tap Capture GPS and choose Allow. | लोकेशन अनुमति अस्वीकार हुई। पंजीकरण के लिए GPS अनिवार्य है — GPS कैप्चर करें दबाएँ और अनुमति दें चुनें। | લોકેશન પરવાનગી નકારાઈ. નોંધણી માટે GPS ફરજિયાત છે — GPS કેપ્ચર કરો દબાવો અને મંજૂરી આપો પસંદ કરો.
Location permission is blocked for MOOZZLE. Open Settings, allow Location (precise), then return and retry. | MOOZZLE के लिए लोकेशन अनुमति अवरुद्ध है। सेटिंग्स खोलें, लोकेशन (सटीक) की अनुमति दें, फिर लौटकर दोबारा प्रयास करें। | MOOZZLE માટે લોકેશન પરવાનગી અવરોધિત છે. સેટિંગ્સ ખોલો, લોકેશન (ચોક્કસ) ની મંજૂરી આપો, પછી પાછા આવી ફરી પ્રયાસ કરો.
Location services (GPS) are turned off on this device. Turn on Location in the phone settings, then retry. | इस डिवाइस पर लोकेशन सेवाएँ (GPS) बंद हैं। फ़ोन सेटिंग्स में लोकेशन चालू करें, फिर दोबारा प्रयास करें। | આ ઉપકરણ પર લોકેશન સેવાઓ (GPS) બંધ છે. ફોન સેટિંગ્સમાં લોકેશન ચાલુ કરો, પછી ફરી પ્રયાસ કરો.
Location services are unavailable. Turn on Location (GPS) on this device, then retry. | लोकेशन सेवाएँ उपलब्ध नहीं हैं। इस डिवाइस पर लोकेशन (GPS) चालू करें, फिर दोबारा प्रयास करें। | લોકેશન સેવાઓ ઉપલબ્ધ નથી. આ ઉપકરણ પર લોકેશન (GPS) ચાલુ કરો, પછી ફરી પ્રયાસ કરો.
The GPS position could not be obtained in time. Move to an open area with a clear view of the sky and retry. | GPS स्थिति समय पर नहीं मिली। खुले स्थान पर जाएँ जहाँ आकाश साफ़ दिखे और दोबारा प्रयास करें। | GPS સ્થાન સમયસર મળ્યું નહીં. ખુલ્લી જગ્યાએ જાઓ જ્યાં આકાશ દેખાય અને ફરી પ્રયાસ કરો.
The device returned invalid coordinates. Retry the GPS capture. | डिवाइस ने अमान्य निर्देशांक दिए। GPS कैप्चर दोबारा करें। | ઉપકરણે અમાન્ય કોઓર્ડિનેટ્સ આપ્યા. GPS કેપ્ચર ફરી કરો.
A mock (simulated) location was detected. Turn off mock-location apps and retry. | नकली (सिम्युलेटेड) लोकेशन मिली। मॉक-लोकेशन ऐप बंद करें और दोबारा प्रयास करें। | નકલી (સિમ્યુલેટેડ) લોકેશન મળ્યું. મોક-લોકેશન એપ બંધ કરો અને ફરી પ્રયાસ કરો.
GPS accuracy is too low (±{n} m). Enable precise location, move outdoors and retry. | GPS सटीकता बहुत कम है (±{n} मी)। सटीक लोकेशन चालू करें, बाहर जाएँ और दोबारा प्रयास करें। | GPS ચોકસાઈ બહુ ઓછી છે (±{n} મી). ચોક્કસ લોકેશન ચાલુ કરો, બહાર જાઓ અને ફરી પ્રયાસ કરો.
The GPS position could not be obtained ({x}). Move outdoors and retry. | GPS स्थिति नहीं मिली ({x})। बाहर जाएँ और दोबारा प्रयास करें। | GPS સ્થાન મળ્યું નહીં ({x}). બહાર જાઓ અને ફરી પ્રયાસ કરો.
The GPS position could not be obtained. Move outdoors and retry. | GPS स्थिति नहीं मिली। बाहर जाएँ और दोबारा प्रयास करें। | GPS સ્થાન મળ્યું નહીં. બહાર જાઓ અને ફરી પ્રયાસ કરો.
Settings could not be opened. Open the phone Settings app → Apps → MOOZZLE → Permissions → Location. | सेटिंग्स नहीं खुल सकीं। फ़ोन की सेटिंग्स → ऐप्स → MOOZZLE → अनुमतियाँ → लोकेशन खोलें। | સેટિંગ્સ ખૂલી શક્યાં નહીં. ફોનની સેટિંગ્સ → એપ્સ → MOOZZLE → પરવાનગીઓ → લોકેશન ખોલો.
GPS location is compulsory — the next step unlocks once it is captured. | GPS लोकेशन अनिवार्य है — कैप्चर होने पर ही अगला चरण खुलेगा। | GPS લોકેશન ફરજિયાત છે — કેપ્ચર થયા પછી જ આગળનું પગલું ખુલશે.
GPS location is compulsory. Capture it before continuing. | GPS लोकेशन अनिवार्य है। आगे बढ़ने से पहले इसे कैप्चर करें। | GPS લોકેશન ફરજિયાત છે. આગળ વધતાં પહેલાં તેને કેપ્ચર કરો.
Complete the {n} highlighted fields before continuing. | आगे बढ़ने से पहले {n} चिह्नित फ़ील्ड पूरे करें। | આગળ વધતાં પહેલાં {n} ચિહ્નિત ફીલ્ડ પૂર્ણ કરો.
Complete the {n} highlighted field before continuing. | आगे बढ़ने से पहले {n} चिह्नित फ़ील्ड पूरा करें। | આગળ વધતાં પહેલાં {n} ચિહ્નિત ફીલ્ડ પૂર્ણ કરો.
Choose the bovine species. | गोवंश प्रजाति चुनें। | ગોવંશ પ્રજાતિ પસંદ કરો.
Choose a breed. | नस्ल चुनें। | ઓલાદ પસંદ કરો.
Age group thresholds are not configured for this species. Ask your administrator to set them in Platform Settings. | इस प्रजाति के लिए आयु वर्ग सीमाएँ निर्धारित नहीं हैं। अपने व्यवस्थापक से प्लेटफ़ॉर्म सेटिंग्स में सेट करने को कहें। | આ પ્રજાતિ માટે ઉંમર જૂથ મર્યાદા નક્કી નથી. તમારા એડમિનિસ્ટ્રેટરને પ્લેટફોર્મ સેટિંગ્સમાં સેટ કરવા કહો.
Answer YES or NO. | हाँ या नहीं चुनें। | હા અથવા ના પસંદ કરો.
Society name is required. | समिति का नाम आवश्यक है। | મંડળીનું નામ જરૂરી છે.
Society code is required. | समिति कोड आवश्यक है। | મંડળી કોડ જરૂરી છે.
Member code is required. | सदस्य कोड आवश्यक है। | સભાસદ કોડ જરૂરી છે.
Choose Status I (DRY, MILK or NA). | स्थिति I चुनें (सूखी, दुधारू या NA)। | સ્થિતિ I પસંદ કરો (વસૂકેલી, દૂઝણી અથવા NA).
Choose Status II (PREGNANT, NON-PREGNANT or NA). | स्थिति II चुनें (गर्भवती, गर्भवती नहीं या NA)। | સ્થિતિ II પસંદ કરો (ગાભણી, ગાભણી નથી અથવા NA).
Owner name, village, district and state are required. | मालिक का नाम, गाँव, ज़िला और राज्य आवश्यक हैं। | માલિકનું નામ, ગામ, જિલ્લો અને રાજ્ય જરૂરી છે.
Choose the assigned farm this animal belongs to. | वह निर्धारित फ़ार्म चुनें जिससे यह पशु संबंधित है। | આ પશુ જે સોંપાયેલ ફાર્મનું છે તે પસંદ કરો.
Some Step 1 details are missing or the GPS location is no longer available. Go back to Details, complete them and capture GPS. | चरण 1 के कुछ विवरण अधूरे हैं या GPS लोकेशन उपलब्ध नहीं है। विवरण पर लौटें, पूरा करें और GPS कैप्चर करें। | પગલું 1 ની કેટલીક વિગતો અધૂરી છે અથવા GPS લોકેશન ઉપલબ્ધ નથી. વિગતો પર પાછા જાઓ, પૂર્ણ કરો અને GPS કેપ્ચર કરો.
Not recorded | दर्ज नहीं | નોંધાયેલ નથી
Dairy society | डेयरी समिति | દૂધ મંડળી
Dairy society member | डेयरी समिति सदस्य | દૂધ મંડળી સભાસદ
Registration GPS | पंजीकरण GPS | નોંધણી GPS
GPS | GPS | GPS
Owner personal, dairy society and GPS details are not shared with the {x} role. | मालिक का व्यक्तिगत, डेयरी समिति और GPS विवरण {x} भूमिका के साथ साझा नहीं किया जाता। | માલિકની વ્યક્તિગત, દૂધ મંડળી અને GPS વિગતો {x} ભૂમિકા સાથે શેર થતી નથી.
{x} (device) · server {x} | {x} (डिवाइस) · सर्वर {x} | {x} (ઉપકરણ) · સર્વર {x}
Choose the bovine species (CATTLE, BUFFALO, BULLOCK or CROSSBREED). | गोवंश प्रजाति चुनें (गाय, भैंस, बैल या संकर नस्ल)। | ગોવંશ પ્રજાતિ પસંદ કરો (ગાય, ભેંસ, બળદ અથવા સંકર ઓલાદ).
A bullock is a male draught animal; set sex to Male. | बैल नर भारवाही पशु है; लिंग नर चुनें। | બળદ નર ખેતીકામનું પશુ છે; જાતિ નર પસંદ કરો.
Society name, society code and member code are required for dairy society members. | डेयरी समिति सदस्यों के लिए समिति का नाम, समिति कोड और सदस्य कोड आवश्यक हैं। | દૂધ મંડળીના સભાસદો માટે મંડળીનું નામ, મંડળી કોડ અને સભાસદ કોડ જરૂરી છે.
Status I must be NA for this animal: only adult female cattle, buffalo or crossbreeds can be MILK or DRY. | इस पशु के लिए स्थिति I NA होनी चाहिए: केवल वयस्क मादा गाय, भैंस या संकर नस्ल दुधारू या सूखी हो सकती है। | આ પશુ માટે સ્થિતિ I NA હોવી જોઈએ: માત્ર પુખ્ત માદા ગાય, ભેંસ કે સંકર ઓલાદ દૂઝણી કે વસૂકેલી હોઈ શકે.
Status II must be NA for males, bullocks and calves. | नर, बैल और बछड़ों के लिए स्थिति II NA होनी चाहिए। | નર, બળદ અને વાછરડાં માટે સ્થિતિ II NA હોવી જોઈએ.
Valid GPS latitude and longitude are required to register an animal. | पशु पंजीकरण के लिए मान्य GPS अक्षांश और देशांतर आवश्यक हैं। | પશુ નોંધણી માટે માન્ય GPS અક્ષાંશ અને રેખાંશ જરૂરી છે.
A mock (simulated) GPS location was detected. Disable mock locations and capture GPS again. | नकली (सिम्युलेटेड) GPS लोकेशन मिली। मॉक लोकेशन बंद करें और GPS फिर से कैप्चर करें। | નકલી (સિમ્યુલેટેડ) GPS લોકેશન મળ્યું. મોક લોકેશન બંધ કરો અને GPS ફરી કેપ્ચર કરો.
GPS location and registration time are invalid. Capture GPS again. | GPS लोकेशन और पंजीकरण समय अमान्य हैं। GPS फिर से कैप्चर करें। | GPS લોકેશન અને નોંધણી સમય અમાન્ય છે. GPS ફરી કેપ્ચર કરો.
`;
