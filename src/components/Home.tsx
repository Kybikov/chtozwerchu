import { useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  AudioLines,
  Check,
  Disc3,
  Monitor,
  Music2,
  Radio,
  Smartphone,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import Backdrop from "./Backdrop";
import BlurText from "./react-bits/BlurText/BlurText";
import { Button, Modal, Panel } from "./ui";
import { AccountButton, useIdentity } from "../lib/identity";
import { savedRoom } from "../lib/studioRoom";
import AppInstall from "./AppInstall";

export function Brand() {
  return (
    <a className="brand" href="/" aria-label="Хто зверху — головна">
      <span className="brand-icon">
        <Zap size={24} fill="currentColor" />
      </span>
      <span>
        хто
        <span className="brand-bottom">
          зверху<span className="brand-dot">?</span>
        </span>
      </span>
    </a>
  );
}
export default function Home() {
  const { user, openAccount } = useIdentity();
  const [help, setHelp] = useState(false);
  const [join, setJoin] = useState(false);
  const [code, setCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const active = savedRoom();
  const goMusic = () => location.assign("/?screen=studio");
  const enterRoom = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = code.trim().toUpperCase();
    if (!/^[A-Z2-9]{5,6}$/.test(clean)) {
      setJoinError("Код має містити 5 або 6 латинських літер і цифр.");
      return;
    }
    location.assign(
      clean.length === 6
        ? `/?screen=room&code=${encodeURIComponent(clean)}`
        : `/?screen=party&code=${encodeURIComponent(clean)}`,
    );
  };
  return (
    <div className="app-shell platform-home">
      <Backdrop effects={localStorage.getItem("khz:effects") !== "off"} />
      <header className="site-header home-header">
        <Brand />
        <nav aria-label="Головна навігація">
          <a href="#formats">
            Обрати гру <ArrowDown size={15} />
          </a>
          <Button variant="ghost" onClick={() => setHelp(true)}>
            Як це працює
          </Button>
        </nav>
        <div className="header-actions">
          <Button
            variant="ghost"
            className="home-join"
            onClick={() => setJoin(true)}
          >
            <Radio size={18} />Є код гри
          </Button>
          <AccountButton />
        </div>
      </header>
      <main className="home-main">
        <section className="home-hero" aria-labelledby="home-title">
          <div className="hero-editorial">
            <div className="section-label">
              <span className="live-dot" /> ВАША КОМПАНІЯ · ВАШЕ ШОУ
            </div>
            <h1 id="home-title">
              <BlurText
                text="СЬОГОДНІ"
                animateBy="words"
                trigger="load"
                delay={60}
              />
              <span className="title-outline">ВИРІШУЄМО,</span>
              <span className="title-pink">
                ХТО ЗВЕРХУ<span className="hero-question">?</span>
              </span>
            </h1>
            <p className="home-lead">
              Дві команди. Улюблені пісні. Трохи азарту.
              <br />І вечір, який не хочеться закінчувати.
            </p>
            <div className="hero-actions">
              <Button
                variant="primary"
                className="hero-start"
                onClick={goMusic}
              >
                <AudioLines size={23} />
                Почати музичне шоу
                <ArrowRight size={21} />
              </Button>
              <span>Без реєстрації. Просто збирайтеся.</span>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="art-glow" />
            <img
              src="/show-vinyl.webp"
              alt=""
              className="home-vinyl"
              fetchPriority="high"
              width="1536"
              height="1024"
            />
            <div className="vinyl-sticker">
              <Disc3 size={22} />
              <span>
                НАЖИВО
                <br />
                <b>У ВАС УДОМА</b>
              </span>
            </div>
            <div className="team-ribbon ribbon-girls">
              ДІВЧАТА <Sparkles size={24} /> ДІВЧАТА
            </div>
            <div className="team-ribbon ribbon-boys">
              ХЛОПЦІ <Zap size={24} fill="currentColor" /> ХЛОПЦІ
            </div>
            <span className="art-caption">
              ГОЛОСНІШЕ МУЗИКУ.
              <br />
              БЛИЖЧЕ СВОЇХ.
            </span>
          </div>
        </section>
        {active && (
          <Panel className="resume-room">
            <Radio size={23} />
            <div>
              <strong>Твоя сцена ще тут</strong>
              <p>
                Повернися до кімнати {active.code}. Після повернення увімкни
                звук вручну.
              </p>
            </div>
            <Button onClick={goMusic}>
              Повернути керування
              <ArrowRight size={18} />
            </Button>
          </Panel>
        )}
        <section
          className="home-formats"
          id="formats"
          aria-labelledby="formats-title"
        >
          <div className="formats-heading">
            <div>
              <span className="section-label">ОБИРАЙ НАСТРІЙ</span>
              <h2 id="formats-title">Який сьогодні вечір?</h2>
            </div>
            <p>
              Один ведучий керує.
              <br />
              Уся компанія змагається.
            </p>
          </div>
          <div className="format-grid">
            <Panel className="format-card music-format">
              <div className="format-top">
                <span className="format-number">01 / МУЗИКА</span>
                <AudioLines size={29} />
              </div>
              <h3>
                А ДАЛІ
                <br />
                <em>ПРОДОВЖИШ ТИ.</em>
              </h3>
              <p>
                Музика зупиняється. Команда має доповнити рядок. Впізнай трек,
                згадай слова й забери свої бали.
              </p>
              <div className="format-features">
                <span>
                  <Music2 size={16} /> Deezer + власні треки
                </span>
                <span>
                  <Monitor size={16} /> TV та пульт
                </span>
              </div>
              <Button variant="primary" onClick={goMusic}>
                Продовж пісню
                <ArrowRight size={20} />
              </Button>
            </Panel>
            <Panel className="format-card party-format">
              <div className="format-top">
                <span className="format-number">02 / КОМПАНІЯ</span>
                <Users size={29} />
              </div>
              <h3>
                ХТО ШВИДШЕ?
                <br />
                <em>ХТО КМІТЛИВІШЕ?</em>
              </h3>
              <p>
                П’ять конкурсів в одній грі: слова, мелодії, Аліас, емодзі та
                несподівані факти. Міняється конкурс, зростає азарт.
              </p>
              <div className="format-features">
                <span>
                  <Users size={16} /> Дві команди
                </span>
                <span>
                  <Smartphone size={16} /> Вхід за кодом
                </span>
              </div>
              <Button onClick={() => location.assign("/?screen=party")}>
                Вечір конкурсів
                <ArrowRight size={20} />
              </Button>
            </Panel>
          </div>
        </section>
        <section className="home-how">
          <div className="how-intro">
            <span className="section-label">
              ЗІБРАТИСЯ ПРОСТІШЕ, НІЖ ЗДАЄТЬСЯ
            </span>
            <h2>
              СВОЇ ЛЮДИ.
              <br />
              <span>ВЕЛИКА СЦЕНА.</span>
            </h2>
          </div>
          <ol>
            <li>
              <span>01</span>
              <div>
                <h3>Збери дві команди</h3>
                <p>
                  Хлопці проти дівчат або власні назви. Як вирішить ваша
                  компанія.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Підготуй гру</h3>
                <p>
                  Обери конкурси або пісню. У музичній студії перевір текст і
                  місце зупинки.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Виведи шоу на екран</h3>
                <p>
                  Грайте з одного ноутбука або відкрийте сцену для гостей.
                  Ведучий задає темп.
                </p>
              </div>
            </li>
          </ol>
        </section>
        {!user && (
          <Panel className="home-account">
            <div>
              <span className="section-label">
                ВЕЧОРИ МИНАЮТЬ. РЕЗУЛЬТАТИ ЛИШАЮТЬСЯ.
              </span>
              <h2>Своя історія перемог</h2>
              <p>
                Створи акаунт, щоб зберігати завершені ігри.
                <br />
                Для першого раунду достатньо твоєї компанії.
              </p>
            </div>
            <Button onClick={() => openAccount("register")}>
              Створити акаунт
              <ArrowRight size={20} />
            </Button>
          </Panel>
        )}
      </main>
      <footer className="home-footer">
        <Brand />
        <span>Зроблено для ваших вечорів.</span>
        <AppInstall />
        <span className="home-version">СТУДІЯ 1.4</span>
      </footer>
      <Modal
        open={join}
        onOpenChange={setJoin}
        title="У вас уже грають?"
        description="Введи код, який бачиш на екрані ведучого."
      >
        <form noValidate className="account-form" onSubmit={enterRoom}>
          <label className="field-label">
            Код гри
            <input
              className="room-code-input"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={6}
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""));
                setJoinError("");
              }}
              placeholder="ВВЕДИ КОД"
            />
          </label>
          {joinError && (
            <p className="form-error" role="alert">
              {joinError}
            </p>
          )}
          <Button type="submit" variant="primary">
            Приєднатися
            <ArrowRight size={20} />
          </Button>
          <p className="account-footnote">
            Для музичної гри відкриється глядацька сцена. Приватний пульт
            ведучого відкривається за його окремим посиланням.
          </p>
        </form>
      </Modal>
      <Modal
        open={help}
        onOpenChange={setHelp}
        title="Це ваше домашнє телешоу"
        description="Потрібні дві команди, ведучий та екран, який бачать усі."
      >
        <div className="home-help">
          <Monitor size={35} />
          <h3>Один екран — уже достатньо</h3>
          <p>
            Відкрий музичну студію на ноутбуці. Підготуй пісню, текст і
            прихований рядок. Після зупинки музики команда продовжує співати, а
            ведучий оцінює відповідь.
          </p>
          <Smartphone size={32} />
          <h3>Телефон може бути пультом</h3>
          <p>
            У студії натисни «Пульт на телефоні». Екран відтворює звук, ведучий
            керує зі свого телефона. Пристрої мають відкривати одну доступну їм
            адресу сайту.
          </p>
          <div className="help-check">
            <Check size={19} />
            Акаунт необов’язковий. Повний аудіофайл можна додати зі свого
            пристрою.
          </div>
        </div>
      </Modal>
    </div>
  );
}
