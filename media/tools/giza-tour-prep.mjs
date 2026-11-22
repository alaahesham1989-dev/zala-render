import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const YT = path.join(REPO, 'content', 'youtube');
fs.mkdirSync(YT, { recursive: true });

const script = {
  id: "ZV-VAR01",
  series: "ZALA Virtual Tour",
  kind: "tour",
  place: "giza-pyramids",
  lang: "ar",
  voice: "Orus",
  voiceStyle: "اتكلم بالعامية المصرية الأصيلة زي حكواتي سينمائي وثائقي فخم وذكي: نبرة صوت عميقة، دافية، فيها تشويق وغموض ووقار، مع وقفات محسوبة بين المقاطع، ولحن كلامي ساحر يشد المشاهد من أول دقيقة لآخر دقيقة، وبدون أي فصحى معقدة.",
  voiceTempo: 1,
  verticalOnly: false,
  noReels: true,
  directed: 8,
  title: "جولة أهرامات الجيزة الافتراضية — أسرار هضبة الفراعنة وأبو الهول",
  thumbnailText: "أسرار هضبة الجيزة كاملة",
  description: "جولة افتراضية سينمائية كاملة مدتها ٢٥ دقيقة تأخذك في قلب هضبة أهرامات الجيزة وأبو الهول: من الهبوط ثلاثي الأبعاد فوق الهضبة، لدخول ممرات وغرف هرم خوفو السرية، وأسرار معبد الوادي، ولوحة الحلم، ومراكب الشمس الملكية.",
  tags: [
    "أهرامات الجيزة",
    "هرم خوفو من الداخل",
    "أبو الهول",
    "جولة افتراضية",
    "مصر القديمة",
    "تاريخ الفراعنة",
    "ZALA VIP"
  ],
  route: {
    mode: "drive",
    summary: "ZALA VIP's limousine from Cairo International Airport: 40 km, about 40 minutes by car",
    legs: [
      {
        mode: "drive",
        from: "Cairo International Airport",
        km: 40,
        minutes: 40,
        line: [
          [31.4056, 30.1219],
          [31.13277778, 29.97611111]
        ]
      }
    ],
    to: {
      lat: 29.97611111,
      lng: 31.13277778,
      name: "Giza Pyramids"
    }
  },
  prepared: {
    at: new Date().toISOString(),
    kind: "tour"
  },
  chapters: [
    {
      title: "الفصل الأول: الهبوط من الفضاء إلى هضبة الجيزة",
      lines: [
        {
          en: "أهلاً بيك في مصر.. من لحظة ما رجلك بتلمس صالة كبار الزوار في مطار القاهرة الدولي، شمس الشرق الدافية بتبدأ تستقبلك بنسمة هواء جاية من عمق آلاف السنين.",
          flight: true,
          clip: {
            url: "https://pub-20815a715a814497b24a479c98b1815e.r2.dev/vault/tour/ZV-V01/flight-1.mp4",
            what: "map flight to the place",
            credit: "© Mapbox © OpenStreetMap",
            license: "Mapbox map (attribution on screen)",
            mapFlight: true
          },
          noMap: true,
          queries: ["cairo international airport terminal exterior", "cairo airport luxury arrival"]
        },
        {
          en: "الليموزين الخاصة بيك بتتحرك بسلاسة على الطريق الدائري السريع، قاطعة أربعين كيلومتر في أقل من ساعة، وفجأة بين العمران بتلمح القمم الحجرية العملاقة بتعانق السحاب.",
          flight: true,
          clip: {
            url: "https://pub-20815a715a814497b24a479c98b1815e.r2.dev/vault/tour/ZV-V01/flight-2.mp4",
            what: "map flight to the place",
            credit: "© Mapbox © OpenStreetMap",
            license: "Mapbox map (attribution on screen)",
            mapFlight: true
          },
          noMap: true,
          queries: ["cairo highway to giza pyramids", "luxurious car driving to pyramids"]
        },
        {
          en: "إحنا دلوقتي بنقرب من حافة الصحراء الغربية.. الكاميرا بتهبط بيك من ارتفاع آلاف الأمتار علشان تشوف هضبة الجيزة بالكامل وهي قايمة زي قلعة أبدية فوق وادي النيل الأخضر.",
          flight: true,
          clip: {
            url: "https://pub-20815a715a814497b24a479c98b1815e.r2.dev/vault/tour/ZV-V01/flight-3.mp4",
            what: "map flight to the place",
            credit: "© Mapbox © OpenStreetMap",
            license: "Mapbox map (attribution on screen)",
            mapFlight: true
          },
          noMap: true,
          queries: ["giza plateau panorama aerial", "three pyramids of giza aerial satellite"]
        },
        {
          en: "عمرك سألت نفسك: ليه الملوك اختاروا هضبة الجيزة بالذات عشان يبنوا عليها أعظم عجائب الدنيا السبع؟ السر كله مخفي في جيولوجيا الأرض وطبيعة الصخر.",
          queries: ["giza plateau bedrock limestone formation", "ancient egypt geological cliff"]
        },
        {
          en: "الهضبة هنا مش رملة ناعمة زي ما كتير فاكرين.. دي قاعدة صخرية جيرية صلبة جداً معروفة علمياً باسم تكوين المقطم، قادرة تشيل أوزان توصل لملايين الأطنان من غير ما تغوص مليمتر واحد.",
          queries: ["giza plateau solid bedrock excavation", "limestone layers giza quarry"]
        },
        {
          en: "وقبل أربعة آلاف وخمسمية سنة، كان المشهد هنا مختلف تماماً عن الصحراء الجافة اللي بنشوفها النهاردة.. كان فرع من فروع النيل القديمة بيوصل لحد أقدام الهضبة مباشرة.",
          queries: ["ancient nile branch river giza pyramids landscape", "nile inundation flood ancient egypt"]
        },
        {
          en: "في موسم الفيضان، اللي المصريين القدماء كانوا بيسموه موسم آخت، كانت مية النيل بتتحول لطريق مائي عظيم بيشيل السفن المحملة بأحجار الجرانيت من أقصى جنوب مصر في أسوان.",
          queries: ["ancient egyptian transport boats on the nile river", "granite transport boat ancient egypt"]
        },
        {
          en: "وعلى الضفة التانية من النيل، كانت محاجر طرة بتنتج أنقى وأجود أنواع الحجر الجيري الأبيض الناصع، اللي اتبعتت منه مئات الآلاف من الكتل علشان تكسي الهرم كأنه قطعة كريستال.",
          queries: ["tura limestone quarry ancient egypt", "white polished limestone block egypt"]
        },
        {
          en: "المهندسون المصريون القدماء خططوا المنطقة كميناء مائي متكامل فيه أحواض تفريغ وقنوات مائية كانت بتوصل الكتل الحجرية لحد منحدرات البناء بالمليمتر.",
          queries: ["ancient harbour basin giza pyramid lehner", "workers canal transport giza plateau"]
        },
        {
          en: "كل حجر اتحط هنا كان محسوب فلكياً وهندسياً.. الهضبة نفسها اتسوت بدقة مذهلة بحيث الفرق في الاستواء بين أبعد نقطتين ما يتعداش سنتيمترات قليلة جداً على مساحة كيلومترات.",
          queries: ["surveying ancient egypt leveling bedrock giza", "giza plateau topographic leveling ancient tools"]
        },
        {
          en: "لما تقف عند طرف الهضبة وتبص على الأفق، بتحس برهبة المكان وهيبته.. الهوا هنا نقي، والصحراء بتتمد غرباً لما لا نهاية، بينما الوادي الأخضر بيمتد شرقاً في تناغم كوني مدهش.",
          queries: ["giza plateau panoramic desert sunset", "view of nile valley from giza pyramids"]
        },
        {
          en: "الهضبة دي مش مجرد مكان لتلات أهرامات زي ما هو شائع.. دي مدينة جنائزية ملكية متكاملة بتضم معابد، ومقابر لمئات الأمراء والوزراء، وموانئ مائية، وقرى كاملة للمهندسين والبناة.",
          queries: ["giza necropolis aerial map overview", "mastaba tombs western cemetery giza"]
        },
        {
          en: "وعلى مر العصور، مرت على الصخور دي أقدام الفراعنة، والإغريق، والرومان، والرحالة، والعلماء، وكل واحد فيهم وقف مذهول قدام دقة الإنجاز وروعة التخطيط.",
          queries: ["historic travelers giza pyramids napoleon 19th century", "ancient travelers visiting giza pyramids"]
        },
        {
          en: "لكن أعظم ما في الهضبة، والنقطة اللي بتجذب عيون العالم كلها من أول لحظة، هو الهرم الأكبر.. جبل الحجر المصنوع بإيدين البشر اللي لسه بيتحدى قوانين الزمن.",
          queries: ["great pyramid khufu majestic view blue sky", "base of great pyramid of giza"]
        },
        {
          en: "استعد.. لأننا دلوقتي هنسيب المشهد البانورامي الخارجي، ونتقدم بخطوات ثابتة نحو سفح الهرم الأكبر، علشان ندخل جوة أعمق ممراته ونكشف أسراره خطوة بخطوة.",
          queries: ["walking towards great pyramid entrance", "tourist walking near great pyramid khufu"]
        },
        {
          en: "يلا بينا نبدأ رحلتنا داخل الهرم الأكبر.. المعجزة الهندسية اللي دوخت علماء العالم على مدار آلاف السنين.",
          queries: ["great pyramid khufu close up stones", "entrance facade of great pyramid of giza"]
        }
      ]
    },
    {
      title: "الفصل الثاني: الهرم الأكبر (خوفو) — المعجزة الهندسية من الخارج والداخل",
      lines: [
        {
          en: "إحنا دلوقتي واقفين مباشرة عند قاعدة هرم الملك خوفو.. لما تقف هنا وترفع عينك لفوق، بتحس بصغر حجمك قدام اتنين مليون وتلتميت ألف كتلة حجرية عملاقة مرصوصة فوق بعضها.",
          queries: ["base of great pyramid khufu massive stone blocks", "tourist standing at base of khufu pyramid"]
        },
        {
          en: "الملك خوفو شيد الهرم ده حوالي سنة ألفين وخمسمية وثمانين قبل الميلاد، ليكون بوابته نحو الخلود في عصر الأسرة الرابعة بالدولة القديمة.",
          queries: ["pharaoh khufu statue iv dynasty cairo museum", "khufu ivory statuette cairo museum"]
        },
        {
          en: "كتير من الناس بيشوفوا الهرم النهاردة ككتل حجرية مدرجة خشنة، لكن الصورة الحقيقية كانت مبهرة لدرجة تفوق الخيال.. الهرم كان مكسو بالكامل بطبقة من الحجر الجيري الأبيض المصقول كالمرايا.",
          queries: ["casing stones great pyramid base smooth tura", "reconstruction of great pyramid white casing gold capstone"]
        },
        {
          en: "الشمس لما كانت بتشرق على الهرم، كانت أشعتها بتنعكس من السطح الأبيض اللامع، فكان الهرم بيضوي في قلب الصحراء زي نجمة عملاقة ممكن تتشاف على بعد أكتر من تلاتين كيلومتر.",
          queries: ["great pyramid shining reflection ancient reconstruction", "pyramidion benben stone gold plated"]
        },
        {
          en: "وكانت قمة الهرم متوجة بحجر البن بن الذهبي، اللي بيمثل أول تل أزلي ظهر من المياه الأزلية حسب العقيدة المصرية القديمة عند بداية خلق الكون.",
          queries: ["benben stone pyramidion dahshur amun", "gold pyramidion apex ancient egypt"]
        },
        {
          en: "دلوقتي تعالوا نطلع شوية على سفح الهرم في الواجهة الشمالية.. هنا قدامنا مدخلين: المدخل الأصلي المبني بأقواس تفريغ حجرية ضخمة، والمدخل التاني أسفله اللي بندخل منه النهاردة.",
          queries: ["original entrance great pyramid khufu rafters", "al mamun entrance breach great pyramid giza"]
        },
        {
          en: "المدخل السفلي ده حفره الخليفة العباسي المأمون سنة تمنمية وعشرين ميلادية، بعد ما استخدم النار والخل لتفتيت الأحجار الجرانيتية بحثاً عن كنوز الفراعنة.",
          queries: ["al mamun breach tunnel stones khufu", "ascending passage junction al mamun hole"]
        },
        {
          en: "أول ما بتخطو جوة الممر، الجو بيتغير تماماً.. درجات الحرارة بتثبت عند حوالي عشرين درجة مئوية صيفاً وشتاءً، وصوت الهوا الخارجي بينقطع تماماً.",
          queries: ["descending passage great pyramid khufu interior", "interior tunnel great pyramid of giza"]
        },
        {
          en: "لو كملت في ممر الهبوط المستقيم بزاوية ستة وعشرين درجة، هتنزل أكتر من مية متر في قلب الصخر الطبيعي تحت الهرم، لحد ما توصل للغرفة التحت أرضية الغامضة.",
          queries: ["subterranean chamber great pyramid rough rock", "unfinished pit subterranean chamber khufu"]
        },
        {
          en: "الغرفة دي محفورة بعمق تلاتين متر تحت مستوى الهضبة، ولسه سقفها وجدرانها غير مكتملة النحت، وكأن المهندس المعماري غير خطته فجأة وقرر يرفع غرف الدفن لفوق في قلب الهرم.",
          queries: ["subterranean chamber bedrock cut giza khufu", "deep subterranean room under great pyramid"]
        },
        {
          en: "بنرجع لمفترق الطرق ونبدأ نصعد في الممر الصاعد.. الممر ضيق وارتفاعه متر وربع بس، ولازم تمشي فيه وأنت موطي ضهرك وسط صمت رهيب وجدران حجرية مطبقة عليك.",
          queries: ["ascending passage ascending tunnel great pyramid", "wooden ramps ascending passage khufu"]
        },
        {
          en: "في نهاية الممر الصاعد، بيتفرع طريق أفقي بيوصل لغرفة الملكة.. الغرفة دي مبنية بالكامل من الحجر الجيري الأبيض الفاخر، وسقفها على شكل جملون هرمي متقن.",
          queries: ["queens chamber great pyramid niche giza", "corbelled niche queens chamber khufu"]
        },
        {
          en: "وفي جدار الغرفة بتشوف تجويف مدرج كابولي غريب كان مخصص لتمثال الكا الخاص بالملك، بالإضافة لفتحات التهوية الضيقة اللي اكتشف العلماء مؤخراً إنها مقفولة بأبواب حجرية ليها مقابض نحاسية.",
          queries: ["upuaut project robot door queens chamber shaft", "djed project robot camera khufu shaft"]
        },
        {
          en: "لكن المفاجأة الكبرى بتستناك لما تطلع من ممر غرفة الملكة وتدخل فجأة على البهو العظيم.. مشهد بيخطف الأنفاس وبيخليك تقف مشلول من الذهول.",
          queries: ["grand gallery great pyramid looking up corbelled", "grand gallery khufu interior wide angle"]
        },
        {
          en: "البهو العظيم صالة صاعدة بطول سبعة وأربعين متر وارتفاع يوصل لتسعة أمتار.. الجدران مبنية بنظام العقد الكابولي، سبع طبقات من الحجر الجيري متراكبة فوق بعضها بدقة ميليمترية معجزة.",
          queries: ["grand gallery corbelled vault stone overlap khufu", "grand gallery ramp side slots khufu pyramid"]
        },
        {
          en: "الفواصل بين الأحجار هنا مفيهاش أي نوع من الملاط أو الإسمنت.. ومع كده مش ممكن تعدي ورقة أو سن شفرة موس بين الحجر والتاني بعد مرور أكتر من أربعة آلاف سنة.",
          queries: ["joint precision ancient egyptian stone masonry", "close up stone joints great pyramid interior"]
        },
        {
          en: "وبعد ما تطلع البهو العظيم بالكامل، بتعبر ردهة صغيرة كانت مقفولة بتلات كتل جرانيتية هابطة زي بوابات القلاع، علشان تلاقي نفسك داخل أقدس نقطة في الهرم: غرفة الملك.",
          queries: ["antechamber portcullis grooves khufu pyramid", "granite portcullis blocks great pyramid"]
        },
        {
          en: "غرفة الملك مبنية بالكامل من صخور الجرانيت الأحمر الأسواني المصقول.. أبعادها الهندسية معمولة بنسب رياضية دقيقة جداً ترتبط بالنسبة الذهبية وثابت الدائرة ط.",
          queries: ["kings chamber great pyramid red granite walls", "kings chamber khufu interior ceiling beams"]
        },
        {
          en: "فوق سقف الغرفة دي فيه تسع كتل جرانيتية ضخمة، وزن الكتلة الواحدة يوصل لخمسين طن.. اترفعت لارتفاع خمسين متر فوق سطح الأرض في عصر مكنش فيه روافع هيدروليكية أو محركات بخارية.",
          queries: ["granite roof beams kings chamber 50 tons", "relieving chambers above kings chamber cross section"]
        },
        {
          en: "وعلشان السقف ميتحطمش تحت وزن ملايين الأطنان من الحجارة، بنى المهندس المصري خمس غرف فوق بعضها اسمها غرف تخفيف الضغط، متوجة بسقف جملوني ضخم بيشتت الحمل للخارج.",
          queries: ["relieving chambers davisons chamber khufu pyramid", "caviglia relieving chambers graffiti khufu"]
        },
        {
          en: "وفي طرف الغرفة الغربي بيقبع التابوت الجرانيتي الوحيد بدون غطاء.. التابوت ده منحوت من كتلة جرانيتية صلبة واحدة، وعرضه أكبر من فتحة الممر، وده معناه إنه اتحط جوة الغرفة أثناء بنائها.",
          queries: ["granite sarcophagus kings chamber khufu empty", "empty stone sarcophagus great pyramid"]
        },
        {
          en: "ولما تضرب بكفك ضربة خفيفة على جدار التابوت الجرانيتي، بتسمع رنين صوتي منخفض وعميق بيتردد في أرجاء الغرفة بالكامل كأنه شوكة رنانة كونية مصنوعة من الصخر.",
          queries: ["kings chamber acoustics resonance khufu", "granite sarcophagus kings chamber close up"]
        },
        {
          en: "والأعجب من كده، إنه سنة ألفين وسبعتاشر، كشف مشروع مسح الأهرامات الدولي باستخدام فيزياء الجسيمات الكونية عن فراغ سري ضخم بطول تلاتين متر فوق البهو العظيم لسه محدش دخله لحد النهاردة.",
          queries: ["scanpyramids big void muon radiography great pyramid", "cosmic ray scanpyramids discovery void"]
        },
        {
          en: "أسرار الهرم الأكبر لسه مخلصتش، لكن جولتنا بتاخدنا دلوقتي برة الهرم الأكبر علشان نتوجه للهرم التاني في الهضبة.. هرم الملك خفرع وصاحب الخدعة البصرية الشهيرة.",
          queries: ["exiting great pyramid looking towards khafre", "pyramid of khafre seen from khufu base"]
        }
      ]
    },
    {
      title: "الفصل الثالث: هرم خفرع ومعبد الوادي الجرانيتي",
      lines: [
        {
          en: "إحنا دلوقتي بنتحرك جنوب غرب الهرم الأكبر، وواقفين قدام هرم الملك خفرع.. ابن الملك خوفو وخامس ملوك الأسرة الرابعة العظيمة.",
          queries: ["pyramid of khafre giza plateau south west", "view of khafre pyramid desert landscape"]
        },
        {
          en: "أول ما تبص لهرم خفرع، هتحس للوهلة الأولى إنه أطول وأضخم من هرم خوفو.. لكن الحقيقة إن دي خدعة بصرية ومعمارية عبقرية نفذها مهندسو الملك.",
          queries: ["optical illusion khafre taller than khufu giza", "khafre and khufu pyramids side by side giza"]
        },
        {
          en: "هرم خفرع في الواقع أقصر من هرم أبوه بحوالي تلاتة متر، لكنه اتبنى على مصطبة صخرية طبيعية في الهضبة بترتفع عشرة متر عن الأرض، وزاوية ميل جدرانه أشد انحداراً بثلاث وخمسين درجة.",
          queries: ["khafre pyramid summit casing stones close up", "steep angle pyramid of khafre summit"]
        },
        {
          en: "الميزة الأجمل في هرم خفرع إنه لسه محتفظ بجزء من كسوته الحجرية الأصلية الملساء عند القمة.. تاج من الحجر الجيري الأبيض بيفكرنا بشكل الهرم الكامل في زمن مجده.",
          queries: ["pyramid of khafre top casing stone mantle", "casing mantle summit pyramid of khafre"]
        },
        {
          en: "مدخل هرم خفرع بيوصل لغرفة دفن واحدة منحوتة في الصخر الطبيعي، فيها تابوت جرانيتي رائع محفور في أرضية الغرفة، غطاه المستكشف الإيطالي بلزوني سنة ألف وتمنمية وتمنتاشر.",
          queries: ["burial chamber pyramid of khafre belzoni sarcophagus", "belzoni inscription inside khafre burial chamber"]
        },
        {
          en: "لكن العبقرية الحقيقية لمجمع خفرع بتبدأ من الطريق الصاعد.. ممر حجري ضخم مرصوف كان مغطى بالكامل، بيمتد لمسافة خمسمية متر نزولاً من الهرم لحد حافة الوادي.",
          queries: ["causeway pyramid of khafre giza plateau", "ruins of causeway khafre mortuary temple"]
        },
        {
          en: "وعند نهاية الطريق الصاعد ده، بنوصل لواحد من أروع المباني وأفضلها حفظاً في كل مصر القديمة: معبد الوادي للملك خفرع.",
          queries: ["valley temple of khafre exterior giza sphinx", "facade valley temple of khafre limestone granite"]
        },
        {
          en: "المعبد ده من برة معمول من الحجر الجيري المحلي، لكن من جوة اتبطن بالكامل بكتل عملاقة من الجرانيت الوردي المصقول المشحون من أسوان.",
          queries: ["valley temple of khafre interior granite pillars", "granite pillars valley temple of khafre giza"]
        },
        {
          en: "أول ما تدخل صالة المعبد الرئيسية على شكل حرف T، بتنبهر بالبساطة والمهابة.. أعمدة مربعة جرانيتية ملساء بدون أي نقوش أو كتابات، بترتفع بكل وقار وكبرياء.",
          queries: ["t-shaped hall valley temple of khafre granite", "colossal granite pillars beams valley temple"]
        },
        {
          en: "والأرضية تحت رجليك مكسوة ببلاطات ضخمة من الألباستر الأبيض المصري النقي.. حجر شفاف بيعكس الضوء بهدوء وسحر خاص.",
          queries: ["alabaster floor valley temple of khafre", "translucent alabaster flooring ancient egypt temple"]
        },
        {
          en: "الضوء في المعبد كان بيدخل من فتحات ضيقة جداً في أعلى الجدران، مسلطة بدقة هندسية على أماكن تماثيل الملك خفرع اللي كانت مرصوصة على طول الجدران.",
          queries: ["light slit valley temple of khafre illumination", "narrow roof windows valley temple giza"]
        },
        {
          en: "المعبد ده كان المكان اللي بتتم فيه طقوس التحنيط وغسل جسد الفرعون، وطقس فتح الفم الشهير لتأهيل الروح للعالم الآخر قبل الصعود للهرم.",
          queries: ["opening of the mouth ritual ancient egypt papyrus", "mummification ritual valley temple ancient egypt"]
        },
        {
          en: "وسنة ألف وتمنمية وستين، كان عالم الآثار الفرنسي أوجست مارييت بينقب في أرضية المعبد، واكتشف بئر عميق في الصالة الشرقية مدفون فيه كنز تاريخي لا يقدر بثمن.",
          queries: ["auguste mariette excavation valley temple giza 1860", "diorite statue pit valley temple discovery"]
        },
        {
          en: "في قاع البئر ده، لقى التحفة الفنية الأشهر في العالم: تمثال الملك خفرع المنحوت من حجر الديوريت الأخضر الداكن النادر.",
          queries: ["statue of khafre diorite cairo museum front", "diorite statue of pharaoh khafre sitting on throne"]
        },
        {
          en: "الديوريت واحد من أصلب الصخور على وجه الأرض، ومع ذلك الفنان المصري نحته بدقة مذهلة، مظهر عضلات الملك، وملامح وشه الهادية الواثقة بالخلود.",
          queries: ["khafre diorite statue side view horus falcon", "khafre diorite statue face close up cairo museum"]
        },
        {
          en: "وأجمل تفصيلة في التمثال ده مش بتتشاف غير من الجنب أو الخلف: الصقر حورس باسط جناحيه من وراء رأس خفرع مباشرة علشان يحميه ويوحده مع الإله.",
          queries: ["horus falcon wings embracing khafre head close up", "horus protecting khafre diorite statue detail"]
        },
        {
          en: "التمثال ده بيجسد المفهوم المصري للملك كإله حي على الأرض، ومحفوظ النهاردة كواحد من أعظم مقتنيات المتحف المصري بالتحرير.",
          queries: ["khafre statue in egyptian museum cairo hall", "diorite statue of khafre gallery display"]
        },
        {
          en: "وعلى بعد أمتار قليلة جداً من معبد الوادي، بيقعد حارس الهضبة الأسطوري اللي عيونه بتبص على الشرق مستنية شروق الشمس من آلاف السنين.",
          queries: ["great sphinx viewed from valley temple roof", "great sphinx of giza with khafre pyramid behind"]
        },
        {
          en: "أبو الهول.. الكائن اللي جمع بين عقل وحكمة الإنسان، وقوة وشجاعة الأسد في صخرة واحدة.",
          queries: ["great sphinx profile view giza pyramids", "majestic great sphinx head side profile"]
        },
        {
          en: "تعالوا نقرب من أبو الهول وننزل بين مخلبيه العملاقة علشان نقرأ قصة الحلم الملكي المنقوشة على صدره.",
          queries: ["walking towards great sphinx paws giza", "great sphinx enclosure giza plateau trench"]
        }
      ]
    },
    {
      title: "الفصل الرابع: أبو الهول — حارس الأفق ولوحة الحلم",
      lines: [
        {
          en: "إحنا دلوقتي نازلين جوة الخندق الصخري لأبو الهول.. التمثال الأضخم والأشهر في تاريخ البشرية، بطول تلاتة وسبعين متر وارتفاع عشرين متر.",
          queries: ["great sphinx trench enclosure deep view", "great sphinx front view between paws"]
        },
        {
          en: "الكتير بيعتقدوا إن أبو الهول اتبنى من أحجار مرصوصة زي الأهرامات، لكن الحقيقة الجيولوجية مدهشة أكتر بكتير: أبو الهول منحوت بالكامل من كتلة صخرية واحدة كانت بارزة في الهضبة.",
          queries: ["great sphinx geological bedrock strata layers", "carving great sphinx from limestone knoll"]
        },
        {
          en: "المهندسون استغلوا النتوء الصخري ده اللي كان باقي في المحجر، وبدل ما يكسروه، حولوه بأزاميل النحاس والمطارق الحجرية لتمثال أسد بجسد ضخم ورأس فرعون يرتدي غطاء النمس الملكي.",
          queries: ["nemes headdress great sphinx uraeus brow", "head of great sphinx giza limestone detail"]
        },
        {
          en: "أبو الهول بيبص مباشرة نحو نقطة الشرق الدقيقة، النقطة اللي بتشرق منها الشمس في يوم الاعتدال الربيعي، وكان اسمه عند المصريين 'حور إم أخت' يعني حورس في الأفق.",
          queries: ["great sphinx facing sunrise equinox east", "sunrise behind great sphinx of giza align"]
        },
        {
          en: "صخرة أبو الهول بتتكون من تلات طبقات جيرية مختلفة الصلابة: الرأس منحوت في أصلب طبقة وده اللي خلاه يعيش آلاف السنين، بينما الجسد في طبقة أضعف اتأثرت بعوامل التعرية والرياح.",
          queries: ["great sphinx body erosion layers limestone strata", "weathering patterns great sphinx body giza"]
        },
        {
          en: "ودلوقتي، تعالوا نقف مباشرة بين المخلبين الأماميين لأبو الهول.. المكان اللي ممنوع دخوله للزوار العاديين ومخصص لجولات كبار الزوار الحصرية.",
          queries: ["between the paws of the great sphinx dream stela", "dream stela thutmose iv between sphinx paws"]
        },
        {
          en: "قدامنا هنا لوحة جرانيتية وردية عملاقة بارتفاع تلاتة متر ونص وعرض مترين وربع، معروفة في كتب التاريخ باسم 'لوحة الحلم'.",
          queries: ["dream stela thutmose iv hieroglyphic inscription", "granite dream stela between paws sphinx close up"]
        },
        {
          en: "اللوحة دي بتسجل قصة درامية حقيقية حصلت في عصر الدولة الحديثة، حوالي سنة ألف وربعمية قبل الميلاد، وبطلها هو الأمير الشاب تحتمس الرابع.",
          queries: ["pharaoh thutmose iv relief karnak temple", "thutmose iv offering to sphinx dream stela"]
        },
        {
          en: "تحتمس كان أمير صغير بيحب الصيد في صحراء الجيزة، وفي يوم من الأيام تعب وقرر يستريح وينام في وقت الظهيرة تحت ظل رقبة أبو الهول اللي كانت الرمال مغطية جسمه بالكامل.",
          queries: ["desert sands covering great sphinx 19th century photo", "sphinx buried in sand vintage historical photo"]
        },
        {
          en: "وأثناء نومه، جاله إله الشمس في الرؤيا وقال له: 'يا بني تحتمس.. بص لحالي، رمال الصحراء خنقتني وغطت جسدي.. لو شلت الرمل ده وحررتني، هخليك ملك على عرش مصر كلها'.",
          queries: ["dream stela upper lunette sphinx double representation", "carving of thutmose iv making offerings to sphinx"]
        },
        {
          en: "تحتمس صحي من نومه ونفذ الوعد فوراً، جمع العمال ورفع أطنان الرمال عن تمثال أبو الهول وبنى جدران طينية لحمايته، وبالفعل تحققت النبوءة وبقى هو الفرعون الحاكم لمصر العظيمة.",
          queries: ["excavation of great sphinx caviglia baraize", "mudbrick protective walls thutmose iv sphinx"]
        },
        {
          en: "وعلشان يخلد الذكرى دي، نحت اللوحة الجرانيتية دي من إحدى عتبات معابد خفرع المجاورة وحطها بين مخلبي أبو الهول لتفضل شاهدة على العهد الأبدي.",
          queries: ["dream stela inscription thutmose iv granite", "close up hieroglyphs dream stela giza"]
        },
        {
          en: "التحاليل الكيميائية والمجهرية الحديثة أثبتت حقيقة مذهلة تانية: أبو الهول في الأصل مكنش بلون الحجر الجيري الأصفر الباهت ده.. كان ملون بألوان زاهية وساحرة.",
          queries: ["traces of red pigment face of great sphinx", "reconstruction painted great sphinx ancient egypt colors"]
        },
        {
          en: "آثار صبغة المغرة الحمراء لسه موجودة على الخدين والوجه كرمز لقوة الشمس وحيويتها، وغطاء الرأس النمس كان مخطط بالأصفر الذهبي والأزرق اللازوردي الملوكي.",
          queries: ["red ochre cheek great sphinx close up traces", "painted nemes headdress ancient egyptian colors"]
        },
        {
          en: "وكان قدام أبو الهول معبد مخصص لعبادته، فيه باحة مفتوحة وأعمدة حجرية ضخمة كانت بتشهد تقديم القرابين للشمس المشرقة والشمس الغاربة.",
          queries: ["sphinx temple ruins giza front view", "sphinx temple pillars limestone megalithic"]
        },
        {
          en: "أما حكاية أنف أبو الهول المفقود، فالخرافة الشعبية اللي بتقول إن مدافع نابليون بونابرت هي اللي كسرته خرافة غير صحيحة علمياً وتاريخياً بالمرة.",
          queries: ["great sphinx nose damage close up chisel marks", "drawings of sphinx without nose frederic norden 1737"]
        },
        {
          en: "الرسومات الأوروبية اللي رسمها الرحالة الدنماركي فريدريك نوردن سنة ألف وسبعمية وسبعة وتلاتين بتوضح إن الأنف كان مكسور قبل ولادة نابليون بسنين طويلة، بآثار أزاميل متعمدة في العصور الوسطى.",
          queries: ["frederic norden sketch great sphinx 1755", "historic sketch of giza sphinx antique engraving"]
        },
        {
          en: "أبو الهول بيفضل اللغز الصامت اللي حير كل من رآه.. حارس أمين بيراقب الزمن وهو بيمر، بينما الحضارات بتولد وتفنى حوالين أقدامه.",
          queries: ["great sphinx sunset dramatic lighting pyramids", "great sphinx looking towards horizon egypt"]
        },
        {
          en: "ودلوقتي، بعد ما استمتعنا بسحر أبو الهول ولوحة الحلم، بنرجع نصعد للهضبة العالية في اتجاه الجنوب الغربي علشان نزور الهرم التالت.. هرم منقرع ومراكب الشمس الملكية.",
          queries: ["pyramid of menkaure giza plateau view", "walking towards third pyramid of giza menkaure"]
        },
        {
          en: "يلا بينا نكتشف ليه الهرم التالت هو الأغلى تكلفة بين كل أهرامات الجيزة، ونشوف معجزة صناعة السفن الفرعونية.",
          queries: ["pyramid of menkaure three queens pyramids giza", "menkaure granite casing stones south base"]
        }
      ]
    },
    {
      title: "الفصل الخامس: هرم منقرع ومراكب الشمس الملكية",
      lines: [
        {
          en: "إحنا دلوقتي عند أقصى الطرف الجنوبي لهضبة الجيزة، قدام هرم الملك منقرع.. حفيد خوفو وابن خفرع وسادس ملوك الأسرة الرابعة.",
          queries: ["pyramid of menkaure panoramic view giza", "menkaure pyramid south view plateau"]
        },
        {
          en: "أول حاجة بتلفت انتباهك هي حجم هرم منقرع.. ارتفاعه حوالي خمسة وستين متر، يعني أقل من نص ارتفاع هرم خوفو الأكبر.",
          queries: ["size comparison menkaure pyramid with khufu", "pyramid of menkaure with its subsidiary pyramids"]
        },
        {
          en: "لكن متخليش الحجم يخدعك.. هرم منقرع كان في زمانه هو الأغلى تكلفة وأفخم مظهر بين كل أهرامات مصر على الإطلاق، والسبب مخفي في كسوته الحجرية.",
          queries: ["red granite casing blocks base menkaure pyramid", "granite blocks unfinished menkaure pyramid giza"]
        },
        {
          en: "الملك منقرع قرر يكسي الستاشر مدماك السفليين من هرمه بكتل من الجرانيت الأحمر الوردي الأسواني، اللي وزنه وصل لعشرات الأطنان للكتلة الواحدة.",
          queries: ["aswan red granite blocks menkaure base close up", "dressed and undressed granite blocks menkaure"]
        },
        {
          en: "شحن الجرانيت لمسافة تسعمية كيلومتر من أقصى جنوب الصعيد ونحته بالصلابة دي كان بيكلف خزينة المملكة أضعاف تكلفة الحجر الجيري المحلي.. وده بيعكس ثراء وفخامة عصر منقرع.",
          queries: ["ancient quarry aswan granite transport", "heavy granite blocks construction menkaure"]
        },
        {
          en: "ولما تقرب من الواجهة الشمالية للهرم، بتشوف فجوة عمودية ضخمة غائرة في جسم الهرم بتبان وكأنها جرح غائر في الصخر.",
          queries: ["northern gash breach pyramid of menkaure al aziz", "al aziz uthman vertical breach menkaure pyramid"]
        },
        {
          en: "الجرح ده وراه قصة تاريخية مدهشة حصلت سنة ألف ومية وستة وتسعين ميلادية، لما قرر السلطان الملك العزيز عثمان بن صلاح الدين الأيوبي إنه يهدم أهرامات الجيزة بالكامل.",
          queries: ["sultan al aziz uthman historical attempt pyramids", "breach on north face pyramid of menkaure"]
        },
        {
          en: "السلطان حشد جيش كامل من النحاتين والبنائين والعمال والخيول، واختار أصغر الأهرامات لهدمه أولاً.. وفضلوا شغالين تمن شهور متواصلة في محاولات مضنية لإسقاط الأحجار بالروافع والحبال.",
          queries: ["workmen trying to dismantle pyramid historical account", "fallen granite blocks base menkaure pyramid"]
        },
        {
          en: "والنتيجة كانت إيه؟ بعد تمن شهور من التعب وصرف ميزانية ضخمة، مقدروش يوقعوا غير حجرين تلاتة في اليوم بصعوبة بالغة، وفي الآخر استسلموا واعترفوا بعجزهم قدام صلابة البناء الفرعوني المعجز.",
          queries: ["menkaure pyramid undamaged structure resilient", "scattered granite stones menkaure pyramid base"]
        },
        {
          en: "وجنب هرم منقرع، بتقف تلات أهرامات صغيرة خاصة بزوجاته الملكات، بتكمل المشهد الجنائزي المهيب لعائلة بناة الأهرام العظام.",
          queries: ["three queens pyramids of menkaure giza plateau", "subsidiary pyramids south of menkaure"]
        },
        {
          en: "ودلوقتي بنرجع لجنوب الهرم الأكبر، علشان نقف قدام واحدة من أعظم الاكتشافات الأثرية في القرن العشرين: مراكب الشمس الملكية.",
          queries: ["khufu solar boat pit south of great pyramid", "solar boat museum original site giza"]
        },
        {
          en: "سنة ألف وتسعمية وأربعة وخمسين، كان المهندس والآثاري المصري كمال الملاخ بينظف جنوب الهرم الأكبر، ولاحظ جدار حجري بيغطي حفرتين مستطيلتين منحوتتين في الصخر ومحكمتين بكتل جيرية ضخمة.",
          queries: ["kamal el mallakh solar boat discovery 1954", "solar boat pit discovery limestone covering blocks"]
        },
        {
          en: "ولما رفعوا أول كتلة حجرية، انبعثت من الحفرة ريحة خشب الأرز العطري بعد ما كانت محبوسة لأكتر من أربعة آلاف وخمسمية سنة في ظلام تام ومحكم.",
          queries: ["lebanese cedar wood solar boat discovery", "dismantled boat pieces inside khufu pit"]
        },
        {
          en: "جوة الحفرة، كانت مركب الملك خوفو مفككة بعناية مذهلة لـ ألف وميتين وأربعة وعشرين قطعة خشبية، مرصوصة في تلاتاشر طبقة زي أحجية هندسية معقدة في انتظار إعادة التجميع.",
          queries: ["reconstruction khufu solar boat ahmed youssef", "restoration work solar ship boat pieces egypt"]
        },
        {
          en: "المرمم العبقري أحمد يوسف قضى أكتر من أربعتاشر سنة في دراسة القطع وإعادة تجميعها بالكامل، لحد ما ظهرت السفينة الملكية بطول تلاتة وأربعين متر وأربعة من عشرة، وعرض يقارب ستة أمتار.",
          queries: ["khufu solar boat fully assembled grand museum", "solar ship of pharaoh khufu complete view"]
        },
        {
          en: "المعجزة هنا إن السفينة دي كلها مصنوعة من خشب الأرز اللبناني الفاخر، ومربوطة بحبال نباتية من نبات الحلفا، بدون استخدام مسمار معدني واحد على الإطلاق.",
          queries: ["rope lashings khufu solar boat construction detail", "wooden joinery mortise tenon solar ship khufu"]
        },
        {
          en: "الأخشاب متداخلة بنظام التعشيق (لسان ونقر)، والحبال لما كانت بتنزل المية كانت بتتمدد وتشد الألواح لبعضها بقوة، فتمنع تسرب نقطة مية واحدة لداخل السفينة.",
          queries: ["oars of khufu solar boat steering steering paddles", "royal cabin deck khufu solar boat cedar"]
        },
        {
          en: "المركب دي كانت مصممة لرحلة الملك خوفو الرمزية في العالم الآخر مع إله الشمس رع، ومحفوظة النهاردة في قاعة خاصة فائقة الحداثة بالمتحف المصري الكبير.",
          queries: ["grand egyptian museum solar boat display hall", "khufu solar boat at grand egyptian museum gem"]
        }
      ]
    },
    {
      title: "الفصل السادس: مدينة بناة الأهرامات والتجربة الملكية لـ ZALA VIP",
      lines: [
        {
          en: "قبل ما نختم جولتنا، في حقيقة تاريخية لازم تتقال بكل وضوح عشان نسقط خرافة اتكررت كتير في أفلام هوليوود والإعلام الغربي.",
          queries: ["archaeological excavations giza plateau workers", "mark lehner excavations heit el ghurab giza"]
        },
        {
          en: "الأهرامات متبنتش بالسخرة، ومتبنتش بعبيد بيضربوا بالسياط، ولا بنتها كائنات فضائية من الفضاء الخارجي.. الأهرامات بناها مصريون أحرار بكل فخر وعقيدة وطنية راسخة.",
          queries: ["heit el ghurab lost city pyramid builders giza", "ancient workers village giza barracks lehner"]
        },
        {
          en: "الحفريات الأثرية اللي قادها الدكتور زاهي حواس والدكتور مارك لينر كشفت عن مدينة العمال الكاملة المعروفة باسم 'حيت الغراب' جنوب شرق الهضبة.",
          queries: ["zahi hawass workers tombs excavation giza", "tombs of the pyramid builders zahi hawass giza"]
        },
        {
          en: "المدينة دي كانت بتضم مخابز عملاقة بتنتج آلاف الأرغفة يومياً، وحظائر ومسالخ ومصانع لتجفيف الأسماك لتقديم وجبات غذائية متكاملة لفرق العمل.",
          queries: ["ancient bakery excavation giza workers village", "fish and cattle bone analysis giza diet lehner"]
        },
        {
          en: "تحليل عظام الحيوانات في المدينة أثبت إن العمال كانوا بياكلوا لحوم الأبقار والأغنام الصغيرة يومياً.. ده كان نظام غذائي ملكي مكنش بياكله غير علية القوم في مصر القديمة.",
          queries: ["faunal remains cattle giza workers elite diet", "meat rations ancient egypt workers giza"]
        },
        {
          en: "وفوق كل ده، فحص الهياكل العظمية لعمال الأهرام في مقابرهم أثبت إنهم تلقوا رعاية طبية متطورة جداً: عمليات تجبير كسور معقدة التئمت بنجاح، وحتى جراحات دقيقة في الجمجمة عاش أصحابها بعدها سنين.",
          queries: ["healed bone fractures pyramid builders skeletons", "ancient egyptian surgery medical care workers skeleton"]
        },
        {
          en: "والدليل الحاسم والأعظم هو مقابر العمال نفسهم.. مكنش ممكن أبداً يُسمح لعبيد إنهم يبنوا مقابرهم الحجرية بجوار أهرامات ملوكهم الخالدة، كشرف ملكي عظيم يخلد أسماءهم للأبد.",
          queries: ["tombs of the pyramid builders painted hieroglyphs", "artisan builder tomb giza false door"]
        },
        {
          en: "بناة الأهرام كانوا عمال مهرة ومهندسين فلكيين وفنانين، نظموا نفسهم في فرق عمل تنافسية بأسماء لطيفة زي 'أصدقاء خوفو' و'طاقم التاج الأبيض'.",
          queries: ["quarry graffiti phyles workers crew names khufu", "gang names hieroglyphs great pyramid relieving chamber"]
        },
        {
          en: "واليوم، بعد آلاف السنين، هضبة الأهرامات لسه بتبهر كل إنسان بيزورها، وبتخليك تعيش تجربة سفر عبر الزمن مش ممكن تنساها طول حياتك.",
          queries: ["pyramids of giza illuminated at night panorama", "night view sound and light pyramids giza"]
        },
        {
          en: "وعشان تعيش التجربة دي بأعلى درجات الراحة والفخامة الملكية، ZALA VIP بتقدملك أسلوب سفر استثنائي مصمم خصيصاً ليك.",
          queries: ["zala vip luxury travel egypt giza limousine", "luxury travel egypt private concierge giza"]
        },
        {
          en: "من لحظة وصولك لمطار القاهرة، سيارتك الليموزين الخاصة بسائقها المحترف بتنقلك مباشرة لفندقك الراقي في القاهرة أو الجيزة.",
          queries: ["luxury limousine transfer cairo airport to hotel", "private driver luxury car pyramids view"]
        },
        {
          en: "وبنوفرلك تصاريح الزيارة الخاصة الحصرية لدخول منطقة الأهرامات وأبو الهول بعد مواعيد الإغلاق الرسمية، لتستمتع بغروب الشمس الساحر في هدوء تام وخصوصية مطلقة بعيداً عن الزحام.",
          queries: ["private sunset tour giza pyramids empty plateau", "exclusive private access great sphinx paws sunset"]
        },
        {
          en: "تقدر كمان تحجز عشاء فاخر بإطلالة بانورامية مباشرة على الأهرامات المضاءة ليلاً بنجوم السماء الصافية، برفقة كبار المرشدين والمتخصصين في علم المصريات.",
          queries: ["luxury dinner overlooking giza pyramids night view", "fine dining terrace pyramids giza illuminated"]
        },
        {
          en: "كل تفصيلة في رحلتك بتتصمم بعناية فائقة لتليق بمكانتك.. خطط لرحلتك القادمة لمصر وزور موقعنا على zalavip.com أو اتواصل معانا مباشرة عبر الواتساب.",
          queries: ["zalavip luxury concierge website booking", "egypt luxury vacation private tour service"]
        },
        {
          en: "شكراً لمتابعتكم جولتنا الافتراضية في هضبة أهرامات الجيزة، واستنونا في جولات جديدة من أعماق التاريخ المصري القديم.",
          queries: ["giza pyramids golden sunset beautiful panorama", "three pyramids of giza desert golden hour"]
        },
        {
          en: "زالا VIP — حكايات الفراعنة اللي مسمعتهاش، وتجربة السفر الملكية اللي تستحقها.",
          queries: ["zala vip luxury brand signature pyramids", "grand panoramic view of giza pyramids sunset"]
        }
      ]
    }
  ]
};

const file = path.join(YT, 'ZV-VAR01.json');
fs.writeFileSync(file, JSON.stringify(script, null, 2) + '\n', 'utf8');

const totalWords = script.chapters.flatMap(c => c.lines).reduce((acc, l) => acc + l.en.split(/\s+/).length, 0);
const totalLines = script.chapters.flatMap(c => c.lines).length;

console.log(`[giza-prep] Wrote ${file}`);
console.log(`[giza-prep] Total chapters: ${script.chapters.length}`);
console.log(`[giza-prep] Total lines: ${totalLines}`);
console.log(`[giza-prep] Total words: ${totalWords}`);
console.log(`[giza-prep] Estimated duration: ~${Math.round(totalWords / 125)} minutes`);
