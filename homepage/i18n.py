# -*- coding: utf-8 -*-
"""
官网三语字典：以中文原文为 key，值为 (英文, 日文)。

- 由 build_i18n.py 读取，对 index.html 的文本节点/属性/JSON-LD/home_v2.js 做整串精确替换。
- ⚠️ key 必须与中文源逐字一致（含空格、全角标点），否则该条不会被替换 —— 构建脚本会报未覆盖清单。
- ⚠️ 涉及口径的文案（KPI 每小时刷新 / 常规路况 / 按次调用 / 多品牌分池）必须与中文源同义，
  禁止改写成「实时」「真实路网」等与代码不符的说法。
- 品牌名「选址赢家Online」在 en/ja 保留中文品牌 + 译名并置，避免生造译名造成品牌割裂。
- 日文用敬体（です/ます），英文用 SaaS 营销语气。
"""
I18N = {
    # ---- 品牌 / 通用 ----
    "选址赢家Online": ("选址赢家Online (SiteWinner)", "选址赢家Online（サイトウィナー）"),
    "选址赢家": ("选址赢家 (SiteWinner)", "选址赢家（サイトウィナー）"),
    "主导航": ("Main navigation", "メインナビゲーション"),
    "操作演示步骤": ("Walkthrough steps", "デモのステップ"),
    "操作演示": ("How it works", "操作デモ"),
    "平台能力": ("Capabilities", "プラットフォーム機能"),
    "选择理由": ("Why choose us", "選ばれる理由"),
    "常见问题": ("FAQ", "よくある質問"),
    "适用场景": ("Use cases", "活用例"),
    "企业级能力": ("Enterprise capabilities", "エンタープライズ機能"),
    "登录": ("Log in", "ログイン"),
    "免费注册": ("Sign up free", "無料登録"),
    "联系我们": ("Contact us", "お問い合わせ"),
    "产品": ("Product", "製品"),
    "支持": ("Support", "サポート"),
    "用户手册": ("User manual", "ユーザーマニュアル"),
    "反馈建议": ("Feedback", "ご意見・ご要望"),
    "上海优事商务咨询有限公司": ("Shanghai Youshi Business Consulting Co., Ltd.", "上海優事商務諮詢有限公司"),
    "沪ICP备2026010607号-1": ("沪ICP备2026010607号-1", "沪ICP备2026010607号-1"),

    # ---- head / SEO ----
    "选址赢家Online - 用数据看清每一平方公里": ("选址赢家Online - See every square kilometer with data", "选址赢家Online - データであらゆる一平方キロを見極める"),
    "选址赢家Online 首页": ("选址赢家Online home", "选址赢家Online ホーム"),
    "选址赢家Online 是 WebGIS 商业智能分析平台：1km 网格商圈人口分析、驾车/步行可达范围、竞品追踪与门店体检、销售预测与 AI 选址建议，帮连锁品牌把开店决策从「凭经验」变成「看数据」。": (
        "选址赢家Online is a WebGIS business intelligence platform: 1km-grid catchment population analysis, driving/walking reachability, competitor tracking and store health checks, sales forecasting and AI site recommendations — helping chain brands turn store-opening decisions from gut feeling into data.",
        "选址赢家OnlineはWebGISビジネスインテリジェンス基盤です。1kmメッシュの商圏人口分析、車・徒歩の到達範囲、競合追跡と店舗ヘルスチェック、売上予測、AI出店提案により、チェーンブランドの出店判断を「経験」から「データ」へ変えます。"),
    "商圈人口 · 竞品格局 · 门店体检 · AI 选址建议。一个平台，把开店决策从经验变成依据。": (
        "Catchment population · Competitive landscape · Store health · AI site recommendations. One platform that turns store-opening decisions into evidence.",
        "商圏人口 · 競合動向 · 店舗ヘルスチェック · AI出店提案。出店判断を経験から根拠へ変える、単一のプラットフォーム。"),
    "商圈人口 · 竞品格局 · 门店体检 · AI 选址建议，一个平台全看清。": (
        "Catchment population · Competitive landscape · Store health · AI site recommendations — all in one platform.",
        "商圏人口 · 競合動向 · 店舗ヘルスチェック · AI出店提案を、ひとつの基盤で。"),
    "选址赢家Online 地图工作台：自有门店与竞品分布同屏": (
        "选址赢家Online map workspace: own stores and competitor locations on one screen",
        "选址赢家Online地図ワークスペース：自社店舗と競合店舗を同一画面で表示"),
    "选址赢家Online 是基于位置大数据的 WebGIS 商业智能分析平台，聚焦商圈人口分析与门店竞争决策。": (
        "选址赢家Online is a WebGIS business intelligence platform built on location big data, focused on catchment population analysis and store competition decisions.",
        "选址赢家Onlineは位置ビッグデータを基盤としたWebGISビジネスインテリジェンス基盤で、商圏人口分析と店舗競争の意思決定に特化しています。"),
    "商圈与整城的人口分析、竞品追踪、门店体检、驾车与步行可达范围、销售预测、AI 选址建议与数据大屏，把开店决策从凭经验变为看数据。支持集团与子公司分层同步、操作审计、管理员两步验证与开放 API。": (
        "Population analysis for catchments and whole cities, competitor tracking, store health checks, driving and walking reachability, sales forecasting, AI site recommendations and dashboards — turning store-opening decisions from guesswork into data. Supports hierarchical group/subsidiary sync, audit logs, admin two-factor authentication and an open API.",
        "商圏・都市全体の人口分析、競合追跡、店舗ヘルスチェック、車・徒歩の到達範囲、売上予測、AI出店提案、ダッシュボードにより、出店判断を経験則からデータドリブンへ。グループ/子会社の階層同期、操作監査、管理者二要素認証、オープンAPIに対応。"),
    "WebGIS 商业智能分析平台，聚焦商圈人口分析与门店竞争决策。": (
        "A WebGIS business intelligence platform focused on catchment population analysis and store competition decisions.",
        "商圏人口分析と店舗競争の意思決定に特化したWebGISビジネスインテリジェンス基盤。"),

    # ---- 图片 alt ----
    "地图工作台：上海全域地图同屏展示自有门店（品牌图标）与竞品门店（绿色数字聚合），左侧面板可按门店状态、图层开关筛选": (
        "Map workspace: Shanghai map showing own stores (brand icons) and competitor stores (green number clusters), left panel filters by store status and layer toggles",
        "地図ワークスペース：上海の地図に自社店舗（ブランドアイコン）と競合店舗（緑の数字クラスタ）を同時表示。左パネルで店舗状態とレイヤーで絞り込み可能"),
    "地图工作台：上海全域地图同屏展示自有门店（品牌图标）与竞品门店（绿色数字聚合），右上角为商圈工具入口": (
        "Map workspace: Shanghai map showing own stores (brand icons) and competitor stores (green number clusters), with the catchment tools entry at top right",
        "地図ワークスペース：上海の地図に自社店舗（ブランドアイコン）と競合店舗（緑の数字クラスタ）を表示。右上に商圏ツールの入口"),
    "地图工作台：右上角展开「商圈工具」菜单，可选商圈内点位、周边商业配套、常住人口分布与开店余地": (
        "Map workspace: Catchment tools menu expanded at top right, with options for in-catchment points, nearby amenities, resident population and store potential",
        "地図ワークスペース：右上で「商圏ツール」メニューを展開し、商圏内ポイント、周辺商業施設、常住人口、出店余地を選択可能"),
    "常住人口分布：以上海五角场万达广场为圆心、半径 3 公里的圆形范围，按 1km 网格分档着色（6 档，颜色越暖人口越密），右侧面板汇总常住人口 72.2 万及各年龄段": (
        "Resident population: a 3km radius circle centered on Wanda Plaza, Wujiaochang, shaded by 1km grid in 6 bands (warmer colors mean denser population), with right panel summarizing 722,000 residents and age breakdown",
        "常住人口：上海五角場ワンダープラザを中心とした半径3kmの円を1kmメッシュで6段階に着色（暖色ほど人口密度が高い）。右パネルに常住人口72.2万人と年齢構成を集計"),
    "竞品门店追踪：上海地图以粉色追踪圈标出竞品分布范围，左上图例说明追踪口径，配合品牌图标区分自家与竞品门店": (
        "Competitor tracking: Shanghai map with pink tracking circles marking competitor distribution, a legend at top left explaining the tracking method, and brand icons distinguishing own from competitor stores",
        "競合店追跡：上海の地図にピンクの追跡圏で競合分布を表示。左上の凡例が追跡口径を説明し、ブランドアイコンで自社店と競合店を区別"),
    "人口数据分析报告（按次调用）：商圈五维星级评分、逐条数据洞察，以及人口结构、年龄分布、到访趋势等图表": (
        "Population analysis report (per-call): five-dimension star rating, line-by-line insights, and charts of population structure, age distribution and visit trends",
        "人口分析レポート（従量呼び出し）：5次元の星評価、個別のインサイト、人口構成・年齢分布・来訪傾向のグラフ"),
    "数据大屏：在营门店与竞品门店数量、覆盖城市与省份、全国门店分布地图、门店城市 TOP10 与竞品品牌 TOP10 排行": (
        "Dashboard: counts of operating stores and competitors, covered cities and provinces, nationwide store distribution map, and top-10 store cities and competitor brands",
        "ダッシュボード：営業店舗数と競合店舗数、対象都市・省份、全国店舗分布地図、店舗都市TOP10と競合ブランドTOP10"),

    # ---- 视频 aria / 播放控件 ----
    "播放产品演示视频": ("Play product demo video", "製品デモ動画を再生"),
    "播放产品演示视频：从城市洞察挑出北京，到商圈洞察看五道口，约 27 秒": (
        "Play product demo video: from city insight shortlisting Beijing, to catchment insight on Wudaokou, about 27 seconds",
        "製品デモ動画を再生：都市インサイトで北京を選び、商圏インサイトで五道口を見る、約27秒"),
    "播放产品演示视频：车行 15 分钟可达范围，约 18 秒": (
        "Play product demo video: 15-minute driving reachability, about 18 seconds",
        "製品デモ動画を再生：車で15分の到達範囲、約18秒"),
    "暂停": ("Pause", "一時停止"),
    "暂停产品演示视频": ("Pause product demo video", "製品デモ動画を一時停止"),
    "重播": ("Replay", "再生し直す"),
    "重播演示": ("Replay demo", "デモを再生し直す"),
    "重新播放产品演示视频": ("Replay product demo video", "製品デモ動画を再生し直す"),
    "继续": ("Resume", "再開"),
    "继续播放": ("Resume playback", "再生を再開"),
    "继续播放产品演示视频": ("Resume product demo video", "製品デモ動画の再生を再開"),
    "播放演示": ("Play demo", "デモを再生"),
    "加载中…": ("Loading…", "読み込み中…"),
    "27 秒": ("27 sec", "27秒"),
    "18 秒": ("18 sec", "18秒"),
    "城市洞察 → 商圈洞察": ("City insight → Catchment insight", "都市インサイト → 商圏インサイト"),
    "车行 15 分钟可达范围": ("15-minute driving reach", "車で15分の到達範囲"),
    "mka-online.cn / 地图工作台": ("mka-online.cn / Map workspace", "mka-online.cn / 地図ワークスペース"),
    "mka-online.cn / 商圈工具 · 车行到达": ("mka-online.cn / Catchment tools · Driving reach", "mka-online.cn / 商圏ツール · 車での到達"),

    # ---- Hero ----
    "基于位置大数据的商业智能分析平台": ("Location-intelligence BI platform", "位置ビッグデータに基づくBI分析基盤"),
    "选址，": ("Site selection, ", "出店判断は、"),
    "看数据": ("powered by data", "データで"),
    "说话": ("", "語る"),
    # v1.13.389 首屏口径：闭店防火墙（餐饮连锁「少开错店」主张）
    "开新店前，": ("Before you open a new store, ", "新店を出す前に、"),
    "先过闭店防火墙": ("clear the closure firewall first", "まず閉店ファイアウォールを確認"),
    "同品牌蚕食预警、双店型识别、坪效测算 —— 开新店前先算清楚：会不会抢了自己老店的生意。少开错一家，比多开十家更值钱。": (
        "Same-brand cannibalization alerts, dual-format detection, sales-per-sqm estimates — work out before you open whether a new store will steal from your own. Avoiding one wrong store beats opening ten right ones.",
        "同ブランドのカニバリゼーション検知、複数業態の識別、坪売上推定——出店前に自店の売上を食い合わないかを計算。誤った1店を避けることは、正しい10店を開くより価値がある。"),
    "商圈人口、竞品格局、门店体检、AI 建议 —— 一个平台，把开店决策从经验变成依据。": (
        "Catchment population, competitive landscape, store health, AI advice — one platform that turns store-opening decisions from experience into evidence.",
        "商圏人口、競合動向、店舗ヘルスチェック、AIアドバイス——出店判断を経験から根拠へ変える、ひとつの基盤。"),
    "商圈人口": ("Catchment population", "商圏人口"),
    "居住、办公、到访、用户画像": ("Residents, workers, visitors, user profiles", "居住・勤務・来訪・ユーザー属性"),
    "竞品追踪": ("Competitor tracking", "競合追跡"),
    "半径内自动计数": ("Auto-count within radius", "半径内を自動集計"),
    "门店体检": ("Store health check", "店舗ヘルスチェック"),
    "自我蚕食看得见": ("See cannibalization clearly", "自社カニバリゼーションを可視化"),
    "AI 选址": ("AI site selection", "AI出店選定"),
    "一句话给出结论": ("One sentence, a clear conclusion", "一言で結論を提示"),
    "看看真实连锁测出什么：549 家门店的体检报告": ("See what a real chain found: a 549-store checkup", "実際のチェーンが見つけたもの：549店舗の診断レポート"),
    "免费开始使用": ("Get started free", "無料で始める"),
    "看 5 步操作演示": ("See the 5-step walkthrough", "5ステップのデモを見る"),
    "免费门店体检（免登录）": ("Free store checkup (no sign-in)", "無料店舗診断（ログイン不要）"),
    "浏览器即用 · 无需安装 · 门店与竞品数据按账号隔离": (
        "Browser-based · No install · Store and competitor data isolated per account",
        "ブラウザですぐ利用 · インストール不要 · 店舗・競合データはアカウントごとに分離"),

    # ---- 操作演示 ----
    "五步，从一张地图到一份结论": ("Five steps, from a map to a conclusion", "5ステップ、地図から結論まで"),
    "下面是线上环境的真实界面。点任一步，看这一步在界面上做什么。": (
        "Below is the real interface from the live product. Click any step to see what it does on screen.",
        "以下は本番環境の実際の画面です。いずれかのステップをクリックすると、画面上での動作を確認できます。"),
    "圈定范围": ("Define the area", "範囲を設定"),
    "选地址或直接框选，半径、驾车、步行三选一": (
        "Pick an address or draw a box; choose radius, driving or walking",
        "住所を選択または範囲を描画。半径・車・徒歩から選択"),
    "看清人口": ("See the population", "人口を把握"),
    "1km 网格逐格上色，5 档读出人口疏密": (
        "1km grid shaded cell by cell, 5 bands show population density",
        "1kmメッシュを段階的に着色、5段階で人口密度を表示"),
    "竞争追踪": ("Track competition", "競合を追跡"),
    "半径内竞品数量、重合度、威胁一屏看清": (
        "Competitor count, overlap and threat level within the radius, all on one screen",
        "半径内の競合数・重複度・脅威度を一画面で把握"),
    "得出结论": ("Reach a conclusion", "結論を得る"),
    "评分、洞察、图表，报告可导出": ("Scores, insights and charts; reports are exportable", "スコア、インサイト、グラフ。レポートはエクスポート可能"),
    "大屏总览": ("Dashboard overview", "ダッシュボード概要"),
    "门店、竞品、覆盖城市，一屏汇总给团队": (
        "Stores, competitors and covered cities summarized for the team on one screen",
        "店舗・競合・対象都市を一画面でチームに共有"),
    "商圈工具": ("Catchment tools", "商圏ツール"),
    "自动播放 · 点步骤可切换": ("Auto-play · Click a step to switch", "自動再生 · ステップをクリックして切替"),

    # ---- 平台能力 ----
    "选址要看的每一面，都在里面": ("Every angle of site selection, in one place", "出店判断に必要なあらゆる視点を、ひとつに"),
    "从人口到竞争，从单店体检到全国大盘。": (
        "From population to competition, from a single store to a nationwide view.",
        "人口から競合まで、単店の診断から全国規模の俯瞰まで。"),
    "半径圈选或整城铺图，1km 网格 6 档着色，档位区间可自定。": (
        "Radius selection or city-wide mapping, 1km grid in 6 bands, with customizable band ranges.",
        "半径指定または都市全体への表示、1kmメッシュを6段階で着色。区分範囲はカスタマイズ可能。"),
    "驾车 / 步行可达": ("Driving / walking reach", "車・徒歩の到達範囲"),
    "按各方向行驶耗时估算 N 分钟可达边界，比半径圆更贴近路网；常规路况，边界可微调。": (
        "Estimates N-minute reach boundaries by travel time per direction — closer to the road network than a radius circle; based on normal traffic conditions, with adjustable boundaries.",
        "方向別の移動時間からN分到達圏を推定。半径円より道路網に近く、通常交通条件を前提に境界を微調整できます。"),
    "网点优化": ("Network optimization", "店舗網最適化"),
    "自家蚕食、竞争强度、竞品追踪，重叠率直接画在图上。": (
        "Self-cannibalization, competitive intensity and competitor tracking — overlap drawn directly on the map.",
        "自社カニバリゼーション、競合強度、競合追跡。重複率を地図上に直接表示。"),
    "自我蚕食、竞品密度、数据完备度，红黄绿灯排序。": (
        "Self-cannibalization, competitor density and data completeness, ranked with red/amber/green lights.",
        "自社カニバリゼーション、競合密度、データ充実度を赤/黄/緑の信号で順位付け。"),
    "销售预测": ("Sales forecasting", "売上予測"),
    "录入真实销售，L1 类比→L2 回归→L3 机器学习随样本升级。": (
        "Enter real sales data; models upgrade with sample size — L1 analogy → L2 regression → L3 machine learning.",
        "実売データを入力。サンプル数に応じてL1類似→L2回帰→L3機械学習へとモデルが高度化。"),
    "AI 选址建议": ("AI site recommendations", "AI出店提案"),
    "结合门店与商圈数据，输出选址结论、客群匹配与风险提示。": (
        "Combines store and catchment data to output a site verdict, customer fit and risk flags.",
        "店舗と商圏のデータを組み合わせ、出店結論・顧客適合性・リスク提示を出力。"),
    "数据大屏": ("Data dashboard", "データダッシュボード"),
    "门店与竞品全国分布一屏投出，KPI 每小时自动刷新。": (
        "Nationwide distribution of stores and competitors on one screen; KPIs refresh automatically every hour.",
        "店舗と競合の全国分布を一画面に。KPIは1時間ごとに自動更新。"),
    "门店清洗": ("Store data cleaning", "店舗データクレンジング"),
    "同址异码、双店型自动识别，合并可一键恢复。": (
        "Auto-detects same address with different codes and dual store types; merges are one-click reversible.",
        "同一住所・異なるコードや複数店舗形態を自動検出。結合はワンクリックで復元可能。"),
    "多品牌竞品口径": ("Multi-brand competitor scope", "複数ブランドの競合範囲"),
    "多品牌账号可按每个自有品牌分别设定竞品范围，竞品计数、购买履历导出与网点优化随之分池；支持集团继承与显式全量。": (
        "Multi-brand accounts can set a competitor scope per own brand; competitor counts, purchase history exports and network optimization are segmented accordingly. Group inheritance and explicit all-brands are supported.",
        "複数ブランドのアカウントでは自社ブランドごとに競合範囲を設定でき、競合数・購入履歴エクスポート・店舗網最適化が分けて集計されます。グループ継承と明示的な全ブランド指定に対応。"),

    # ---- 适用场景 ----
    "不同行业，问的是不同的问题": ("Different industries, different questions", "業種が異なれば、問うべきことも異なる"),
    "选址系统不该只给一个通用分数，而是回答你这一行真正要回答的那个问题。": (
        "A site-selection system should not just give a generic score — it should answer the question your industry actually faces.",
        "出店支援システムは単一の汎用スコアではなく、その業界が本当に答えるべき問いに答えるべきです。"),
    "连锁餐饮": ("Restaurant chains", "飲食チェーン"),
    "这条街的午市和晚市客流，撑不撑得起这个租金。": (
        "Whether lunch and dinner footfall on this street can justify the rent.",
        "この通りの昼・夜の来客数が家賃を賄えるか。"),
    "茶饮 / 咖啡": ("Tea / coffee shops", "ティー・コーヒー店"),
    "写字楼密度和到访人口，哪个更决定出杯量。": (
        "Whether office density or visitor population better drives cup volume.",
        "オフィス密度と来訪人口のどちらが杯数を左右するか。"),
    "便利店": ("Convenience stores", "コンビニエンスストア"),
    "三公里内到底还缺不缺一个 24 小时店。": (
        "Whether a 24-hour store is still missing within three kilometers.",
        "3km圏内に24時間店がまだ不足しているか。"),
    "连锁药店": ("Pharmacy chains", "調剤・ドラッグチェーン"),
    "社区老龄化程度，和已有药店的真实步行距离。": (
        "How aged the neighborhood is, and the real walking distance to existing pharmacies.",
        "地域の高齢化度と、既存薬局までの実際の徒歩距離。"),
    "连锁零售": ("Retail chains", "小売チェーン"),
    "商场店与街边店，同一个品牌能差多少。": (
        "How much a brand can differ between a mall store and a street-side store.",
        "同じブランドでも、ショッピングモール店と路面店でどれだけ差が出るか。"),
    "汽车服务": ("Automotive services", "自動車サービス"),
    "车行 15 分钟圈里，究竟有多少潜在车主。": (
        "How many potential car owners actually fall within a 15-minute drive.",
        "車で15分圏内に、実際に何人の潜在的ドライバーがいるか。"),
    "品牌加盟": ("Franchise expansion", "フランチャイズ展開"),
    "进入一座新城市，第一个点应该先落在哪。": (
        "When entering a new city, where the first location should go.",
        "新しい都市に進出するとき、最初の拠点をどこに置くか。"),
    "集团总部": ("Group headquarters", "グループ本社"),
    "全国几百家店，哪几家该调整、哪几家该关。": (
        "With hundreds of stores nationwide, which to adjust and which to close.",
        "全国数百店舗のうち、どこを調整しどこを閉鎖すべきか。"),

    # ---- 可达范围 ----
    "可达范围": ("Reachability", "到達範囲"),
    "车行 15 分钟，能覆盖多少人": ("Who falls within a 15-minute drive", "車で15分、どれだけの人をカバーできるか"),
    "在商圈工具里画一个 15 分钟车行圈，圈内常住人口、分龄结构、竞品数量一次算出来。": (
        "Draw a 15-minute driving zone in the catchment tools; resident population, age structure and competitor count are calculated at once.",
        "商圏ツールで15分の車圏を描くと、圏内の常住人口・年齢構成・競合数をまとめて算出します。"),

    # ---- 选择理由 ----
    "同样是管门店，为什么还要一套选址系统": (
        "If you already manage stores, why add a site-selection system",
        "店舗管理は同じでも、なぜ出店支援システムが必要なのか"),
    "地图负责告诉你店在哪，选址赢家负责判断该不该开在这。": (
        "Maps tell you where a store is; SiteWinner tells you whether it should be there.",
        "地図は店舗の場所を教えてくれる。选址赢家はそこに出すべきかを判断する。"),
    "01　门店数据": ("01　Store data", "01　店舗データ"),
    "02　人口与客流": ("02　Population & footfall", "02　人口と来客"),
    "03　决策输出": ("03　Decision output", "03　意思決定のアウトプット"),
    "通用地图 App": ("General map app", "一般的な地図アプリ"),
    "收藏点，只有名称和位置": ("Saved pins with only a name and location", "お気に入りは名称と位置だけ"),
    "结构化门店库：品牌、经营状态、面积、商圈类型，可筛选、可统计": (
        "Structured store database: brand, operating status, area, catchment type — filterable and analyzable",
        "構造化された店舗DB：ブランド、営業状態、面積、商圏タイプ。絞り込み・集計が可能"),
    "一张热力图，看不出多少人、什么年龄段": (
        "A heat map alone can't tell you how many people, or of which ages",
        "ヒートマップだけでは人数も年齢構成も分からない"),
    "最小 1km 网格分龄人口，可按半径聚合或整城 / 区县铺图，档位区间可自定义": (
        "Age-segmented population down to 1km grids, aggregatable by radius or mapped city/district-wide, with customizable bands",
        "最小1kmメッシュの年齢別人口。半径別集計や都市・区全体への表示が可能で、区分もカスタマイズできます"),
    "看到的是位置，判断还得靠人": ("You see a location; the judgment is still on you", "見えるのは場所だけで、判断は人がする"),
    "开店余地、竞争强度、AI 建议，直接给出候选区域与理由": (
        "Store potential, competitive intensity and AI advice — candidate areas and reasons given directly",
        "出店余地、競合強度、AI提案により、候補エリアと理由を直接提示"),
    "维度": ("Dimension", "観点"),
    "数据归属": ("Data ownership", "データの所有"),
    "门店存在个人账号里，换人换机就散了": (
        "Stores live in a personal account — lost when people or devices change",
        "店舗情報が個人アカウントに保存され、担当者や端末の変更で分散する"),
    "存在自己库里，随时可导出，账号之间互相隔离": (
        "Stored in your own database, exportable anytime, isolated between accounts",
        "自社データベースに保存され、いつでもエクスポート可能。アカウント間は分離"),
    "分析能力": ("Analysis capability", "分析機能"),
    "能看热力图，算不出半径内到底多少人": (
        "Can show a heat map, but not how many people are actually within a radius",
        "ヒートマップは見えても、半径内の正確な人数は算出できない"),
    "按半径聚合、多条件阈值筛选，一次算出候选区域": (
        "Aggregate by radius, filter by multiple thresholds, calculate candidate areas in one pass",
        "半径別集計と複数条件のしきい値絞り込みで、候補エリアを一度に算出"),
    "竞品计数": ("Competitor counting", "競合店の集計"),
    "一家家搜，数量靠眼数": ("Search one by one, count by eye", "一軒ずつ検索し、目で数える"),
    "内置竞品库按半径自动计数，自家门店蚕食加权": (
        "Built-in competitor database auto-counts by radius, with weighting for own-store cannibalization",
        "内蔵の競合DBが半径別に自動集計し、自社店舗のカニバリゼーションを加重"),
    "决策依据": ("Basis for decisions", "判断根拠"),
    "看到位置和路线，判断靠经验": ("You see locations and routes; judgment relies on experience", "場所とルートが見えるだけで、判断は経験依存"),
    "开店余地、竞争强度、AI 建议与销售预测": (
        "Store potential, competitive intensity, AI advice and sales forecasting",
        "出店余地、競合強度、AI提案、売上予測"),
    "成果输出": ("Output", "成果物"),
    "截图贴进 PPT，改一次重来一次": (
        "Screenshots pasted into slides — redo everything after each change",
        "スクリーンショットを資料に貼り付け、変更のたびに作り直し"),
    "一键导出 Excel / PDF，分析结果可复用": (
        "One-click Excel / PDF export; analysis results are reusable",
        "ワンクリックでExcel/PDFをエクスポート。分析結果は再利用可能"),
    "团队协作": ("Team collaboration", "チーム連携"),
    "一个账号大家共用，谁改的说不清": (
        "One shared account — no clear record of who changed what",
        "単一アカウントの共有で、誰が何を変更したか不明"),
    "多账号 + 集团 / 子公司数据隔离与权限": (
        "Multiple accounts with group/subsidiary data isolation and permissions",
        "複数アカウントとグループ/子会社のデータ分離・権限管理"),
    "人口数据来自运营商授权数据源，按次计量调用": (
        "Population data comes from a licensed carrier source, billed per call",
        "人口データは通信事業者のライセンスデータ源に基づき、呼び出しごとに課金"),

    # ---- 企业级能力 ----
    "多账号、可追溯、能集成": ("Multi-account, traceable, integrable", "複数アカウント、追跡可能、連携対応"),
    "演示视频里放不下的部分：权限、留痕、数据治理与对外接口，都已经在系统里。": (
        "What the demo can't show — permissions, audit trails, data governance and external APIs — is already in the system.",
        "デモでは紹介しきれない権限、監査履歴、データガバナンス、外部APIも、すでにシステム内にあります。"),
    "操作审计日志": ("Audit logs", "操作監査ログ"),
    "管理员可按操作人、动作、日期筛选审计记录，覆盖账号、配额、城市数据与两步验证等敏感操作，含时间、IP 与变更详情。": (
        "Admins can filter audit records by operator, action and date, covering sensitive operations such as accounts, quotas, city data and two-factor authentication, with time, IP and change details.",
        "管理者は操作者・操作内容・日付で監査記録を絞り込めます。アカウント、クォータ、都市データ、二要素認証などの機微操作を対象に、時刻・IP・変更内容を記録。"),
    "管理员两步验证": ("Admin two-factor authentication", "管理者二要素認証"),
    "管理员账号可开启基于 TOTP 的两步验证，兼容标准验证器 App，并配 8 张一次性恢复码；必要时可由管理员重置。": (
        "Admin accounts can enable TOTP-based two-factor authentication, compatible with standard authenticator apps, with eight one-time recovery codes; admins can reset it when needed.",
        "管理者アカウントはTOTPベースの二要素認証を有効化できます。標準の認証アプリに対応し、8枚の使い捨て復旧コードを発行。必要に応じて管理者がリセット可能です。"),
    "集团 / 子公司同步": ("Group / subsidiary sync", "グループ/子会社同期"),
    "按子公司分层管理门店与配额，同步前先预览、逐行留痕。成功批次可回滚：辖区划拨可回退归属与销售记录，普通同步可撤回本批新增的镜像副本。": (
        "Manage stores and quotas hierarchically by subsidiary; preview before sync with row-level audit trails. Successful batches can be rolled back: territory transfers restore ownership and sales records, and regular syncs can withdraw the batch's new mirror copies.",
        "子会社ごとに店舗とクォータを階層管理。同期前にプレビューし、行単位で履歴を残します。成功バッチはロールバック可能：管轄の移動は所属と売上履歴を戻し、通常同期は当該バッチのミラーコピーを取り消せます。"),
    "竞品期次快照": ("Competitor period snapshots", "競合店・期次スナップショット"),
    "按月或季导入竞品门店快照，按门店 ID 对齐两期在营门店，自动算出新开店、闭店与状态变化，可导出变更明细。快照需人工逐期上传。": (
        "Import competitor store snapshots monthly or quarterly, align operating stores across two periods by store ID, automatically derive openings, closures and status changes, and export change details. Snapshots must be uploaded manually each period.",
        "競合店舗のスナップショットを月次または四半期ごとに取り込み、店舗IDで2期の営業店舗を照合して新規出店・閉店・状態変化を自動算出。変更明細もエクスポートできます。スナップショットは各期に手動でアップロードが必要です。"),
    "API 开放": ("Open API", "API公開"),
    "面向合作客户提供联通人口数据接口，凭 API Key 调用、按次计费；管理员在后台管理客户、余额与用量明细。": (
        "Provides a carrier population data API for partners, called with an API Key and billed per call; admins manage clients, balances and usage details in the backend.",
        "提携先向けに通信事業者の人口データAPIを提供。APIキーで呼び出し、従量課金。管理者は管理画面で顧客・残高・利用明細を管理します。"),
    "AI 操作助手": ("AI operations assistant", "AI操作アシスタント"),
    "内置 20 个 Function Calling 工具，覆盖筛选、统计、POI 检索与人口对比；另有 2 条场景引导共 10 步（网点规划 6 步、单店评估 4 步）。": (
        "Built with 20 function-calling tools covering filtering, statistics, POI search and population comparison, plus two guided scenarios of 10 steps in total (network planning 6, single-store evaluation 4).",
        "絞り込み、集計、POI検索、人口比較をカバーする20個のFunction Callingツールを内蔵。さらに2つのシナリオガイド計10ステップ（店舗網計画6、単店評価4）を提供。"),
    "城市洞察 / 商圈洞察": ("City / catchment insight", "都市インサイト / 商圏インサイト"),
    "城市机会评分按市场规模、竞争强度、品牌空白与消费潜力加权，权重可调；商圈综合评分拆解为人口规模、消费能力、竞争宽松度与客流活跃四维。": (
        "City opportunity scores are weighted by market size, competitive intensity, brand whitespace and spending potential, with adjustable weights; catchment scores break down into population size, purchasing power, competitive headroom and footfall activity.",
        "都市機会スコアは市場規模・競合強度・ブランド空白・消費力で重み付けし、重みは調整可能。商圏総合スコアは人口規模・購買力・競合のゆとり・来客活動の4次元に分解。"),
    "人口网格与色阶": ("Population grid & color scale", "人口メッシュと色階"),
    "1km 网格之外还提供 250 米高精人口网格（管理员导入）；色阶图例与网格上色同源，支持等值均分与分位分档，网格数字标签可随时开关。": (
        "Beyond 1km grids, a 250m high-precision population grid is available (admin import); the color-scale legend shares its source with grid shading, supporting equal-interval and quantile bands, with grid number labels toggleable anytime.",
        "1kmメッシュに加え、250mの高精度人口メッシュ（管理者が取り込み）も提供。色階の凡例はメッシュ着色と同じソースで、等間隔・分位の区分に対応し、メッシュの数値ラベルはいつでも切り替え可能。"),

    # ---- FAQ ----
    "你可能想先知道": ("You may want to know first", "まず知りたいこと"),
    "需要安装软件吗？": ("Do I need to install software?", "ソフトウェアのインストールは必要ですか？"),
    "不需要。浏览器打开就能用，Windows 与 macOS 的桌面浏览器都支持，无需安装任何客户端。目前完整功能按电脑端设计。": (
        "No. Just open it in a browser — Windows and macOS desktop browsers are both supported, with no client to install. Full functionality is designed for desktop.",
        "いいえ。ブラウザで開くだけで利用でき、WindowsとmacOSのデスクトップブラウザに対応。クライアントのインストールは不要です。現時点ではフル機能はパソコン向けに設計されています。"),
    "支持哪些城市？": ("Which cities are supported?", "どの都市に対応していますか？"),
    "按城市开通。系统里的城市下拉列表就是当前已开通的范围；需要新的城市可以联系我们申请，通常按区域陆续开通。": (
        "Cities are enabled individually. The city dropdown in the system shows the currently available range; contact us to request a new city, which are usually rolled out region by region.",
        "都市ごとに開通しています。システム内の都市ドロップダウンが現在の利用可能範囲です。新しい都市はお問い合わせください。通常、地域ごとに順次開通します。"),
    "门店数据怎么导入？": ("How do I import store data?", "店舗データはどう取り込みますか？"),
    "用 Excel 或 CSV 模板批量导入，门店编码、名称、地址、面积、状态等字段一次带入，也可以在地图上逐条添加。同一个地址编码不同的重复门店，导入后会自动识别出来。": (
        "Bulk-import with an Excel or CSV template, bringing in store code, name, address, area, status and other fields at once; you can also add stores one by one on the map. Duplicate stores with the same address but different codes are auto-detected after import.",
        "ExcelまたはCSVテンプレートで一括取り込みできます。店舗コード、名称、住所、面積、状態などをまとめて取り込み可能で、地図上で1件ずつ追加することもできます。同じ住所でコードが異なる重複店舗は、取り込み後に自動で検出されます。"),
    "人口数据来自哪里，准确吗？": ("Where does population data come from, and is it accurate?", "人口データはどこから来て、正確ですか？"),
    "接入运营商级人口大数据，经匿名化处理，按 1km 网格统计人口量级与人群结构，用于判断区域的量级与分布趋势。": (
        "We integrate carrier-grade population big data, anonymized and aggregated on 1km grids by population scale and demographics, for judging an area's magnitude and distribution trends.",
        "通信事業者級の人口ビッグデータを接続し、匿名化処理のうえ1kmメッシュごとに人口規模と属性を集計。エリアの規模と分布動向の判断に使用します。"),
    "人口数据多久更新一次？": ("How often is population data updated?", "人口データはどのくらいの頻度で更新されますか？"),
    "按月更新，购买的人口数据报告会标明所用的数据年月。人口是慢变量，月度更新足以支撑选址判断。": (
        "Updated monthly; purchased population reports state the data year and month used. Population changes slowly, so monthly updates are sufficient for site decisions.",
        "月次で更新されます。購入した人口データレポートには使用したデータの年月が記載されます。人口は緩やかに変化するため、月次更新で出店判断には十分です。"),
    "我的门店数据是私有的吗？": ("Is my store data private?", "店舗データは非公開ですか？"),
    "按账号隔离，其他账号看不到你的门店明细；平台做区域统计时只使用匿名坐标，不展示门店名称、地址与销售数据。": (
        "Yes. Data is isolated per account — others cannot see your store details. Regional statistics use only anonymized coordinates; store names, addresses and sales data are never shown.",
        "はい。アカウントごとに分離されており、他のアカウントは店舗明細を見られません。地域統計には匿名化された座標のみを使用し、店舗名・住所・売上データは表示しません。"),
    "多人协作和集团多子公司支持吗？": ("Do you support team collaboration and multi-subsidiary groups?", "チーム連携やグループ・複数子会社に対応していますか？"),
    "支持。账号按角色区分权限，集团可以按子公司分层管理门店与配额，子公司的数据互相隔离，总部能看到汇总；同步批次可预览与回滚。管理员还能查操作审计日志（含操作人、时间与 IP），并为自己的账号开启 TOTP 两步验证。": (
        "Yes. Accounts have role-based permissions; groups can manage stores and quotas hierarchically by subsidiary, with subsidiary data isolated and headquarters seeing roll-ups. Sync batches can be previewed and rolled back. Admins can also review audit logs (operator, time, IP) and enable TOTP two-factor authentication on their own account.",
        "対応しています。アカウントは役割ごとに権限が分かれ、グループは子会社ごとに店舗とクォータを階層管理できます。子会社間データは分離され、本社は集計を閲覧可能。同期バッチはプレビューとロールバックに対応。管理者は監査ログ（操作者・時刻・IP）を確認し、自分のアカウントにTOTP二要素認証を設定できます。"),
    "只有几家店，用得上吗？": ("Is it useful if I only have a few stores?", "店舗が数軒だけでも使えますか？"),
    "门店少的时候，价值主要在开店之前——先看清目标商圈的人口和竞品，再决定签不签。门店多了以后，体检和蚕食分析的作用才会显现出来。": (
        "With few stores, the value is mainly before opening — see the target catchment's population and competitors first, then decide whether to sign. Health checks and cannibalization analysis become more useful as your store count grows.",
        "店舗が少ない段階では、出店前の価値が中心です。対象商圏の人口と競合を先に把握し、契約するか判断します。店舗が増えてくると、ヘルスチェックやカニバリゼーション分析の効果が現れます。"),
    "和 Excel 自己拉表比，差别在哪？": ("How is it different from building my own Excel sheets?", "Excelで独自に表を作るのとどう違いますか？"),
    "Excel 存的是你已经知道的数据；系统把人口、竞品、可达范围算好，叠在同一张地图上，还能按半径或车行时间随时改口径重算。": (
        "Excel holds data you already know; the system calculates population, competitors and reachability, layers them on one map, and lets you change the radius or drive time and recalculate anytime.",
        "Excelは既に知っているデータを保存するものです。本システムは人口・競合・到達範囲を算出して同じ地図上に重ね、半径や車での移動時間を変えていつでも再計算できます。"),
    "分析报表能直接用于汇报吗？": ("Can analysis reports be used directly for presentations?", "分析レポートはそのまま報告に使えますか？"),
    "可以。购买记录与门店体检结果都能导出 Excel / PDF，含统计明细与地图截图，可直接用于内部汇报或客户提案。": (
        "Yes. Purchase records and store health results export to Excel / PDF with statistical details and map screenshots, ready for internal reports or client proposals.",
        "はい。購入履歴と店舗ヘルスチェック結果は、統計明細と地図スクリーンショット付きでExcel/PDFにエクスポートでき、社内報告や顧客提案にそのまま利用できます。"),
    "手机上能用吗？": ("Can I use it on mobile?", "スマートフォンでも使えますか？"),
    "能打开，但系统目前按电脑端设计。地图叠图层、批量导入和深度分析请在桌面浏览器上完成；手机上适合浏览已分享的分析结论。": (
        "It opens, but the system is currently designed for desktop. Please use a desktop browser for map layers, bulk import and in-depth analysis; mobile is suited to viewing shared conclusions.",
        "開けますが、現時点ではパソコン向けに設計されています。地図レイヤー、一括取り込み、詳細分析はデスクトップブラウザで行ってください。モバイルは共有された分析結果の閲覧に適しています。"),
    "多个品牌怎么分别算竞品？": ("How are competitors counted separately for multiple brands?", "複数ブランドの競合はどう分けて集計しますか？"),
    "在「竞品门店」页为每个自有品牌配置对应的竞品品牌，配置完成后竞品计数、报告与网点优化都会按该品牌分池；也可以继承集团配置，或显式选择「全部品牌（不筛选）」。没有配置过时按全量处理，多品牌账号会先提示完成配置。": (
        "On the Competitor Stores page, configure a competitor brand for each of your own brands. Once set, competitor counts, reports and network optimization are segmented per brand. You can also inherit the group configuration or explicitly choose All Brands (no filter). If not configured, all brands are used; multi-brand accounts are prompted to complete configuration first.",
        "「競合店舗」ページで自社ブランドごとに対応する競合ブランドを設定します。設定後、競合数・レポート・店舗網最適化はブランドごとに分けて集計されます。グループ設定の継承や「全ブランド（絞り込みなし）」の明示選択も可能。未設定の場合は全件扱いとなり、複数ブランドのアカウントにはまず設定完了を促す案内が表示されます。"),

    # ---- 结尾 CTA / 页脚 ----
    "准备好用数据做一次选址决策了吗": ("Ready to make a data-driven site decision?", "データで出店判断してみませんか"),
    "免费注册账号，几分钟跑完第一次商圈分析。": (
        "Sign up free and run your first catchment analysis in minutes.",
        "無料登録で、数分後に初めての商圏分析を実行できます。"),
    "人口数据来自运营商授权数据源": ("Population data from a licensed carrier source", "人口データは通信事業者のライセンスデータ源に基づく"),
    "© 2026 选址赢家Online · 位置智能分析平台": (
        "© 2026 选址赢家Online · Location Intelligence Platform",
        "© 2026 选址赢家Online · ロケーションインテリジェンス基盤"),

    # ---- home_v2.js 动态文案 ----
    "「商圈工具」：半径 / 驾车 / 步行": ("Catchment tools: radius / driving / walking", "商圏ツール：半径 / 車 / 徒歩"),
    "半径 3km 内 72.2 万人，颜色越暖人口越密": (
        "722,000 people within 3km; warmer colors mean denser population",
        "半径3km内に72.2万人。暖色ほど人口密度が高い"),
    "追踪圈按竞品分布生成，圈内竞品一图看清": (
        "Tracking circles follow competitor distribution, showing competitors inside at a glance",
        "追跡圏は競合分布に基づき生成。圏内の競合を一眺で把握"),
    "五个维度打分，商圈成色一眼看清": (
        "Five-dimension scoring reveals the catchment's quality at a glance",
        "5次元のスコアリングで商圏の成色がひと目で分かる"),
    "门店、竞品、覆盖城市，一屏汇总": (
        "Stores, competitors and covered cities summarized on one screen",
        "店舗・競合・対象都市を一画面で集約"),
}
